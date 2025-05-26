from django.shortcuts import render
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Contact, FriendRequest
from .serializers import ContactSerializer, FriendRequestSerializer, UserSerializer
from authentication.models import User
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from django.db import transaction, IntegrityError
from django.db.models import Q
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from django.utils import timezone
from datetime import timedelta
import logging

logger = logging.getLogger(__name__)

class CustomPagination(PageNumberPagination):
    page_size = 10
    page_size_query_param = 'page_size'
    max_page_size = 100

def paginate_queryset(queryset, request, serializer_class):
    paginator = CustomPagination()
    paginated_data = paginator.paginate_queryset(queryset, request)
    serializer = serializer_class(paginated_data, many=True, context={'request': request})
    return paginator.get_paginated_response(serializer.data)

def notify_users(channel_layer, user_id, event):
    async_to_sync(channel_layer.group_send)(f"user_{user_id}", event)

class GetContactsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            contacts = Contact.objects.filter(user=request.user).select_related('friend__profile').order_by('-created_at')
            return paginate_queryset(contacts, request, ContactSerializer)
        except Exception as e:
            logger.error(f"Error in GetContactsView: {str(e)}")
            return Response({"error": f"Failed to fetch contacts: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class SearchContactsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            query = request.query_params.get('query', '')
            contacts = Contact.objects.filter(
                user=request.user,
                friend__username__icontains=query
            ).select_related('friend__profile').order_by('friend__username')
            return paginate_queryset(contacts, request, ContactSerializer)
        except Exception as e:
            logger.error(f"Error in SearchContactsView: {str(e)}")
            return Response({"error": f"Failed to search contacts: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# contacts/views.py
class SearchUsersView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            query = request.query_params.get('query', '')
            if not query:
                return Response({"error": "Query parameter is required"}, status=status.HTTP_400_BAD_REQUEST)

            # Search across username, email, first_name, and full name (first_name + last_name)
            users = User.objects.filter(
                Q(username__icontains=query) |  # Search by username
                Q(email__icontains=query) |     # Search by email
                Q(first_name__icontains=query) |  # Search by first_name
                Q(last_name__icontains=query) |   # Search by last_name
                Q(first_name__icontains=query.split()[0]) & Q(last_name__icontains=query.split()[-1]) if ' ' in query else Q()  # Search by full name
            ).exclude(id=request.user.id).select_related('profile').distinct()

            return paginate_queryset(users, request, UserSerializer)
        except Exception as e:
            logger.error(f"Error in SearchUsersView: {str(e)}")
            return Response({"error": f"Failed to search users: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class SentFriendRequestsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            sent_requests = FriendRequest.objects.filter(sender=request.user, accepted=False).select_related('receiver')
            serializer = FriendRequestSerializer(sent_requests, many=True)
            return Response(serializer.data)
        except Exception as e:
            logger.error(f"Error in SentFriendRequestsView: {str(e)}")
            return Response({"error": f"Failed to fetch sent requests: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class AddFriendView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            username = request.data.get('username')
            if not username:
                return Response({"error": "Username is required"}, status=status.HTTP_400_BAD_REQUEST)

            friend = User.objects.get(username=username)
            if friend == request.user:
                return Response({"error": "You cannot add yourself as a friend"}, status=status.HTTP_400_BAD_REQUEST)

            if Contact.objects.filter(user=request.user, friend=friend).exists():
                return Response({"error": "You are already friends"}, status=status.HTTP_400_BAD_REQUEST)

            with transaction.atomic():
                contact = Contact(user=request.user, friend=friend)
                contact.save()
                mutual_contact = Contact(user=friend, friend=request.user)
                mutual_contact.save()

                serializer = ContactSerializer(contact, context={'request': request})
                mutual_serializer = ContactSerializer(mutual_contact, context={'request': request})

                channel_layer = get_channel_layer()
                notify_users(channel_layer, request.user.id, {
                    "type": "friend_added",
                    "contact": serializer.data
                })
                notify_users(channel_layer, friend.id, {
                    "type": "friend_added",
                    "contact": mutual_serializer.data
                })
                logger.info(f"Mutual contacts added between {request.user.first_name} and {friend.first_name}")

            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except User.DoesNotExist:
            return Response({"error": f"User '{username}' not found"}, status=status.HTTP_404_NOT_FOUND)
        except IntegrityError as e:
            logger.error(f"IntegrityError in AddFriendView: {str(e)}")
            return Response({"error": f"Database constraint failed: {str(e)}"}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.error(f"Error in AddFriendView: {str(e)}")
            return Response({"error": f"Unexpected error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class GetContactsWithProfilesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            contacts = Contact.objects.filter(user=request.user).select_related('friend__profile').order_by('-created_at')
            serializer = ContactSerializer(contacts, many=True, context={'request': request})
            return Response(serializer.data)
        except Exception as e:
            logger.error(f"Error in GetContactsWithProfilesView: {str(e)}")
            return Response({"error": f"Failed to fetch contacts with profiles: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

# contacts/views.py
class SendFriendRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        username = request.data.get('username')
        if not username:
            return Response({"error": "Username is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            receiver = User.objects.get(username=username)
            if receiver == request.user:
                return Response({"error": "You cannot send a request to yourself"}, status=status.HTTP_400_BAD_REQUEST)

            # Check for existing friend relationship
            if Contact.objects.filter(user=request.user, friend=receiver).exists():
                return Response({"error": "You are already friends"}, status=status.HTTP_400_BAD_REQUEST)

            # Check for an existing pending request from sender to receiver
            if FriendRequest.objects.filter(sender=request.user, receiver=receiver, accepted=False).exists():
                return Response({"error": "Friend request already sent"}, status=status.HTTP_400_BAD_REQUEST)

            # Check for an existing pending request from receiver to sender
            if FriendRequest.objects.filter(sender=receiver, receiver=request.user, accepted=False).exists():
                return Response(
                    {"error": "You have a pending friend request from this user. Please accept or reject it first."},
                    status=status.HTTP_400_BAD_REQUEST
                )

            with transaction.atomic():
                friend_request = FriendRequest(sender=request.user, receiver=receiver)
                friend_request.save()
                serializer = FriendRequestSerializer(friend_request)

                channel_layer = get_channel_layer()
                # Notify the receiver of the new friend request
                notify_users(channel_layer, receiver.id, {
                    "type": "friend_request_received",
                    "request": {
                        "id": friend_request.id,
                        "sender": {"first_name": request.user.first_name, "username": request.user.username}
                    }
                })
                # Notify the sender that the request was sent
                notify_users(channel_layer, request.user.id, {
                    "type": "friend_request_sent",
                    "request": {
                        "id": friend_request.id,
                        "receiver": {"first_name": receiver.first_name, "username": receiver.username}
                    }
                })
                logger.info(f"Friend request sent from {request.user.first_name} to {receiver.first_name}")

            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except User.DoesNotExist:
            return Response({"error": f"User '{username}' not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error in SendFriendRequestView: {str(e)}")
            return Response({"error": f"Unexpected error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class GetFriendRequestsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            requests = FriendRequest.objects.filter(receiver=request.user, accepted=False).select_related('sender')
            serializer = FriendRequestSerializer(requests, many=True)
            return Response(serializer.data)
        except Exception as e:
            logger.error(f"Error in GetFriendRequestsView: {str(e)}")
            return Response({"error": f"Failed to fetch friend requests: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class AcceptFriendRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, request_id):
        try:
            friend_request = FriendRequest.objects.get(id=request_id, receiver=request.user, accepted=False)
            logger.info(f"Found friend request {request_id} from {friend_request.sender.first_name} to {request.user.first_name}")

            with transaction.atomic():
                friend_request.accepted = True
                friend_request.save()
                logger.info(f"Friend request {request_id} marked as accepted")

                # Ensure mutual contacts
                receiver_contact, created1 = Contact.objects.get_or_create(
                    user=request.user, friend=friend_request.sender
                )
                sender_contact, created2 = Contact.objects.get_or_create(
                    user=friend_request.sender, friend=request.user
                )
                if created1:
                    logger.info(f"Contact created: {request.user.first_name} -> {friend_request.sender.first_name}")
                if created2:
                    logger.info(f"Contact created: {friend_request.sender.first_name} -> {request.user.first_name}")

                receiver_contact_data = ContactSerializer(receiver_contact, context={'request': request}).data
                sender_contact_data = ContactSerializer(sender_contact, context={'request': request}).data

                channel_layer = get_channel_layer()
                notify_users(channel_layer, friend_request.sender.id, {
                    "type": "friend_request_accepted",
                    "requestId": friend_request.id,
                    "friend_first_name": request.user.first_name,
                    "contact": sender_contact_data
                })
                notify_users(channel_layer, request.user.id, {
                    "type": "friend_request_accepted",
                    "requestId": friend_request.id,
                    "friend_first_name": friend_request.sender.first_name,
                    "contact": receiver_contact_data
                })
                logger.info(f"WebSocket notifications sent for friend request {request_id}")

            return Response({"status": "Friend request accepted", "friend_first_name": friend_request.sender.first_name}, status=status.HTTP_200_OK)
        except FriendRequest.DoesNotExist:
            logger.warning(f"Friend request {request_id} not found or already processed")
            return Response({"error": "Friend request not found or already processed"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error in AcceptFriendRequestView: {str(e)}")
            return Response({"error": f"Failed to accept friend request: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class RejectFriendRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, request_id):
        try:
            friend_request = FriendRequest.objects.get(id=request_id, receiver=request.user, accepted=False)
            sender = friend_request.sender

            with transaction.atomic():
                friend_request.delete()
                logger.info(f"Friend request {request_id} rejected by {request.user.first_name}")

                channel_layer = get_channel_layer()
                notify_users(channel_layer, sender.id, {
                    "type": "friend_request_rejected",
                    "requestId": request_id,
                    "rejected_by": request.user.first_name
                })
                notify_users(channel_layer, request.user.id, {
                    "type": "friend_request_rejected",
                    "requestId": request_id,
                    "rejected_user": sender.first_name
                })

            return Response({"status": "Friend request rejected"}, status=status.HTTP_200_OK)
        except FriendRequest.DoesNotExist:
            logger.warning(f"Friend request {request_id} not found or already processed")
            return Response({"error": "Friend request not found or already processed"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error in RejectFriendRequestView: {str(e)}")
            return Response({"error": f"Failed to reject friend request: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class RemoveFriendView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, friend_id):
        try:
            # Fetch the contact to be removed
            contact = Contact.objects.get(user=request.user, friend_id=friend_id)
            friend = contact.friend

            with transaction.atomic():
                # Delete the mutual contact (if it exists)
                mutual_contact = Contact.objects.filter(user=friend, friend=request.user)
                if mutual_contact.exists():
                    mutual_contact.delete()
                    logger.info(f"Mutual contact for {friend.first_name} deleted")

                # Delete the contact
                contact.delete()
                logger.info(f"Contact for {friend.first_name} deleted")

                # Notify both users via WebSocket
                channel_layer = get_channel_layer()
                notify_users(channel_layer, request.user.id, {
                    "type": "friend_removed",
                    "friend_id": friend_id,
                    "friend_first_name": friend.first_name,
                    "message": f"You have removed {friend.first_name} from your contacts."
                })
                notify_users(channel_layer, friend_id, {
                    "type": "friend_removed",
                    "friend_id": request.user.id,
                    "friend_first_name": request.user.first_name,
                    "message": f"{request.user.first_name} has removed you from their contacts."
                })

            return Response({"status": "Friend removed successfully"}, status=status.HTTP_200_OK)
        except Contact.DoesNotExist:
            logger.warning(f"Friend {friend_id} not found in contacts for user {request.user.id}")
            return Response({"error": "Friend not found in your contacts"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error in RemoveFriendView: {str(e)}")
            return Response({"error": f"Failed to remove friend: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)