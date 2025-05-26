from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Group, GroupMessage
from .serializers import GroupSerializer, GroupMessageSerializer, UserSerializer
from authentication.models import User
from rest_framework.permissions import IsAuthenticated
from django.core.paginator import Paginator, EmptyPage
from django.utils.dateparse import parse_datetime
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
import logging

logger = logging.getLogger(__name__)

class CreateGroupView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            group_name = request.data.get("name")
            members_ids = request.data.get("members", [])
            if not group_name:
                logger.warning(f"User {request.user.id} attempted to create group without name")
                return Response({"error": "Group name is required"}, status=status.HTTP_400_BAD_REQUEST)

            creator = request.user
            members = User.objects.filter(id__in=members_ids)
            if not members.exists() and members_ids:
                logger.error(f"Invalid member IDs provided by user {request.user.id}: {members_ids}")
                return Response({"error": "Invalid member IDs"}, status=status.HTTP_400_BAD_REQUEST)

            group = Group.objects.create(name=group_name, creator=creator)
            group.members.set(members)
            group.members.add(creator)
            group.admins.add(creator)
            group.save()

            group_message = GroupMessage.objects.create(
                group=group,
                sender=None,
                message=f"System Helper: Group {group_name} created by {creator.first_name}"
            )
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group.id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(group_message, context={'request': request}).data
                }
            )
            async_to_sync(channel_layer.group_send)(
                f"group_{group.id}",
                {
                    "type": "group_updated",
                    "group": GroupSerializer(group, context={'request': request}).data
                }
            )

            logger.info(f"Group {group.id} created by user {request.user.id}")
            return Response(GroupSerializer(group, context={'request': request}).data, status=status.HTTP_201_CREATED)
        except Exception as e:
            logger.error(f"Error creating group by user {request.user.id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class GroupListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            query = request.query_params.get('query', None)
            groups = Group.objects.filter(members=request.user)
            if query:
                groups = groups.filter(name__icontains=query)
            serializer = GroupSerializer(groups, many=True, context={'request': request})
            logger.info(f"User {request.user.id} fetched group list with query: {query}")
            return Response(serializer.data, status=status.HTTP_200_OK)
        except Exception as e:
            logger.error(f"Error fetching group list for user {request.user.id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class GroupDetailsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, group_id):
        try:
            group = Group.objects.get(id=group_id)
            if not group.members.filter(id=request.user.id).exists():
                logger.warning(f"User {request.user.id} is not a member of group {group_id}")
                return Response({"error": "You are not a member of this group"}, status=status.HTTP_403_FORBIDDEN)

            total_messages = GroupMessage.objects.filter(group=group).count()
            total_members = group.members.count()

            group_data = {
                "id": group.id,
                "name": group.name,
                "created_at": group.created_at,
                "total_members": total_members,
                "total_messages": total_messages,
                "can_members_send_messages": group.can_members_send_messages,
                "creator": UserSerializer(group.creator).data,
                "admins": UserSerializer(group.admins.all(), many=True).data,
                "members": UserSerializer(group.members.all(), many=True).data,
                "profile_picture": group.profile_picture.url if group.profile_picture else None,
            }

            logger.info(f"User {request.user.id} fetched details for group {group_id}")
            return Response(group_data, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error fetching group details for group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class GetGroupMessagesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, group_id):
        logger.info(f"Fetching messages for group {group_id} by user {request.user.id}")
        try:
            group = Group.objects.get(id=group_id)
            if not group.members.filter(id=request.user.id).exists():
                logger.warning(f"User {request.user.id} is not a member of group {group_id}")
                return Response({"error": "You are not a member of this group"}, status=status.HTTP_403_FORBIDDEN)

            messages = GroupMessage.objects.filter(group=group).order_by('timestamp')
            since = request.query_params.get('since')
            if since:
                since_dt = parse_datetime(since)
                if since_dt:
                    messages = messages.filter(timestamp__gt=since_dt)

            page = request.query_params.get('page', 1)
            page_size = request.query_params.get('page_size', 20)

            paginator = Paginator(messages, page_size)
            try:
                paginated_messages = paginator.page(page)
                serializer = GroupMessageSerializer(paginated_messages, many=True, context={'request': request})
                logger.info(f"Returning {len(serializer.data)} messages for group {group_id}")
                return Response({
                    'results': serializer.data,
                    'next': paginated_messages.has_next(),
                    'previous': paginated_messages.has_previous(),
                    'count': paginator.count
                })
            except EmptyPage:
                logger.info(f"Empty page for group {group_id}, page {page}")
                return Response({
                    'results': [],
                    'next': False,
                    'previous': paginator.num_pages > 1,
                    'count': paginator.count
                }, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error fetching messages for group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class SendGroupMessageView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            group_id = request.data.get("group_id")
            message = request.data.get("message")
            attachment = request.FILES.get("attachment", None)
            file_name = request.data.get("file_name", attachment.name if attachment else None)
            file_type = request.data.get("file_type", attachment.content_type if attachment else None)
            parent_message_id = request.data.get("parent_message_id")

            group = Group.objects.get(id=group_id)
            if not group.members.filter(id=request.user.id).exists():
                logger.warning(f"User {request.user.id} is not a member of group {group_id}")
                return Response({"error": "You are not a member of this group"}, status=status.HTTP_403_FORBIDDEN)

            if attachment:
                max_size = 10 * 1024 * 1024  # 10MB
                if attachment.size > max_size:
                    logger.warning(f"User {request.user.id} uploaded file exceeding 10MB for group {group_id}")
                    return Response({"error": "File size exceeds 10MB limit"}, status=status.HTTP_400_BAD_REQUEST)

            kwargs = {
                'group': group,
                'sender': request.user,
                'message': message,
                'attachment': attachment,
                'file_name': file_name,
                'file_type': file_type,
            }
            if parent_message_id:
                try:
                    parent_message = GroupMessage.objects.get(id=parent_message_id, group=group)
                    kwargs['parent_message'] = parent_message
                except GroupMessage.DoesNotExist:
                    logger.error(f"Parent message {parent_message_id} not found in group {group_id}")
                    return Response({"error": "Parent message not found"}, status=status.HTTP_404_NOT_FOUND)

            group_message = GroupMessage.objects.create(**kwargs)

            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(group_message, context={'request': request}).data
                }
            )

            logger.info(f"Message sent to group {group_id} by user {request.user.id}")
            return Response(GroupMessageSerializer(group_message, context={'request': request}).data, status=status.HTTP_201_CREATED)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error sending message for group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class EditGroupMessageView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, group_id, message_id):
        try:
            group = Group.objects.get(id=group_id)
            message = GroupMessage.objects.get(id=message_id, group=group)
            
            is_admin_or_creator = request.user in group.admins.all() or request.user == group.creator
            if message.sender != request.user and not is_admin_or_creator:
                logger.warning(f"User {request.user.id} unauthorized to edit message {message_id} in group {group_id}")
                return Response({"error": "You are not authorized to edit this message"}, status=status.HTTP_403_FORBIDDEN)

            new_message = request.data.get("message")
            if not new_message:
                logger.warning(f"User {request.user.id} provided empty message for editing message {message_id}")
                return Response({"error": "New message content is required"}, status=status.HTTP_400_BAD_REQUEST)

            message.message = new_message
            message.save()

            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(message, context={'request': request}).data
                }
            )

            logger.info(f"Message {message_id} edited in group {group_id} by user {request.user.id}")
            return Response(GroupMessageSerializer(message, context={'request': request}).data, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except GroupMessage.DoesNotExist:
            logger.error(f"Message {message_id} not found in group {group_id}")
            return Response({"error": "Message not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error editing message {message_id} in group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class DeleteGroupMessageView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, group_id, message_id):
        try:
            group = Group.objects.get(id=group_id)
            message = GroupMessage.objects.get(id=message_id, group=group)
            
            is_admin_or_creator = request.user in group.admins.all() or request.user == group.creator
            if message.sender != request.user and not is_admin_or_creator:
                logger.warning(f"User {request.user.id} unauthorized to delete message {message_id} in group {group_id}")
                return Response({"error": "You are not authorized to delete this message"}, status=status.HTTP_403_FORBIDDEN)

            message.delete()

            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message_deleted",
                    "message_id": message_id
                }
            )

            logger.info(f"Message {message_id} deleted in group {group_id} by user {request.user.id}")
            return Response({"status": "Message deleted successfully"}, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except GroupMessage.DoesNotExist:
            logger.error(f"Message {message_id} not found in group {group_id}")
            return Response({"error": "Message not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error deleting message {message_id} in group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class AddMemberToGroupView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id, user_id):
        try:
            group = Group.objects.get(id=group_id)
            user = User.objects.get(id=user_id)

            if request.user not in group.admins.all():
                logger.warning(f"User {request.user.id} attempted to add member without admin rights for group {group_id}")
                return Response({"error": "Only admins can add members"}, status=status.HTTP_403_FORBIDDEN)

            if user in group.members.all():
                logger.info(f"User {user_id} is already a member of group {group_id}")
                return Response({"error": "User is already a member of the group"}, status=status.HTTP_400_BAD_REQUEST)

            group.members.add(user)
            group.save()

            group_message = GroupMessage.objects.create(
                group=group,
                sender=None,
                message=f"System Helper: {user.first_name} was added to the group by {request.user.first_name}"
            )
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(group_message, context={'request': request}).data
                }
            )
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_updated",
                    "group": GroupSerializer(group, context={'request': request}).data
                }
            )

            logger.info(f"User {user_id} added to group {group_id} by {request.user.id}")
            return Response({"status": "User added to group"}, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except User.DoesNotExist:
            logger.error(f"User {user_id} not found")
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error adding member to group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class RemoveMemberFromGroupView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id, user_id):
        try:
            group = Group.objects.get(id=group_id)
            user = User.objects.get(id=user_id)

            if request.user not in group.admins.all():
                logger.warning(f"User {request.user.id} attempted to remove member without admin rights for group {group_id}")
                return Response({"error": "Only admins can remove members"}, status=status.HTTP_403_FORBIDDEN)

            if user not in group.members.all():
                logger.info(f"User {user_id} is not a member of group {group_id}")
                return Response({"error": "User is not a member of the group"}, status=status.HTTP_400_BAD_REQUEST)

            if user == group.creator:
                logger.warning(f"Attempt to remove group owner {user_id} from group {group_id}")
                return Response({"error": "Cannot remove the group owner"}, status=status.HTTP_400_BAD_REQUEST)

            group.members.remove(user)
            group.admins.remove(user)
            group.save()

            group_message = GroupMessage.objects.create(
                group=group,
                sender=None,
                message=f"System Helper: {user.first_name} was removed from the group by {request.user.first_name}"
            )
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(group_message, context={'request': request}).data
                }
            )
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_updated",
                    "group": GroupSerializer(group, context={'request': request}).data
                }
            )

            logger.info(f"User {user_id} removed from group {group_id} by {request.user.id}")
            return Response({"status": "User removed from group"}, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except User.DoesNotExist:
            logger.error(f"User {user_id} not found")
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error removing member from group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class AssignAdminView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id, user_id):
        try:
            group = Group.objects.get(id=group_id)
            user = User.objects.get(id=user_id)

            if request.user != group.creator:
                logger.warning(f"User {request.user.id} attempted to assign admin without ownership for group {group_id}")
                return Response({"error": "Only the group owner can assign admin rights"}, status=status.HTTP_403_FORBIDDEN)

            if user not in group.members.all():
                logger.warning(f"User {user_id} is not a member of group {group_id}")
                return Response({"error": "User must be a member of the group to be assigned as admin"}, status=status.HTTP_400_BAD_REQUEST)

            if user in group.admins.all():
                logger.info(f"User {user_id} is already an admin in group {group_id}")
                return Response({"error": "User is already an admin"}, status=status.HTTP_400_BAD_REQUEST)

            group.admins.add(user)
            group.save()

            group_message = GroupMessage.objects.create(
                group=group,
                sender=None,
                message=f"System Helper: {user.first_name} was granted admin rights by {request.user.first_name}"
            )
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(group_message, context={'request': request}).data
                }
            )
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_updated",
                    "group": GroupSerializer(group, context={'request': request}).data
                }
            )

            logger.info(f"User {user_id} assigned as admin in group {group_id} by {request.user.id}")
            return Response({"status": "User assigned as admin"}, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except User.DoesNotExist:
            logger.error(f"User {user_id} not found")
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error assigning admin for group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class RevokeAdminView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id, user_id):
        try:
            group = Group.objects.get(id=group_id)
            user = User.objects.get(id=user_id)

            if request.user != group.creator:
                logger.warning(f"User {request.user.id} attempted to revoke admin without ownership for group {group_id}")
                return Response({"error": "Only the group owner can revoke admin rights"}, status=status.HTTP_403_FORBIDDEN)

            if user == group.creator:
                logger.warning(f"Attempt to revoke admin rights from owner {user_id} in group {group_id}")
                return Response({"error": "Cannot revoke admin rights from the group owner"}, status=status.HTTP_400_BAD_REQUEST)

            if user not in group.admins.all():
                logger.info(f"User {user_id} is not an admin in group {group_id}")
                return Response({"error": "User is not an admin"}, status=status.HTTP_400_BAD_REQUEST)

            group.admins.remove(user)
            group.save()

            group_message = GroupMessage.objects.create(
                group=group,
                sender=None,
                message=f"System Helper: {user.first_name}'s admin rights were revoked by {request.user.first_name}"
            )
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(group_message, context={'request': request}).data
                }
            )
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_updated",
                    "group": GroupSerializer(group, context={'request': request}).data
                }
            )

            logger.info(f"Admin rights revoked for user {user_id} in group {group_id} by {request.user.id}")
            return Response({"status": "Admin rights revoked"}, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except User.DoesNotExist:
            logger.error(f"User {user_id} not found")
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error revoking admin for group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class TransferOwnershipView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id, user_id):
        try:
            group = Group.objects.get(id=group_id)
            new_owner = User.objects.get(id=user_id)

            if request.user != group.creator:
                logger.warning(f"User {request.user.id} attempted to transfer ownership without ownership for group {group_id}")
                return Response({"error": "Only the group owner can transfer ownership"}, status=status.HTTP_403_FORBIDDEN)

            if new_owner == group.creator:
                logger.info(f"User {user_id} is already the owner of group {group_id}")
                return Response({"error": "User is already the group owner"}, status=status.HTTP_400_BAD_REQUEST)

            if new_owner not in group.members.all():
                logger.warning(f"User {user_id} is not a member of group {group_id}")
                return Response({"error": "User must be a member of the group to become the owner"}, status=status.HTTP_400_BAD_REQUEST)

            group.creator = new_owner
            if new_owner not in group.admins.all():
                group.admins.add(new_owner)
            if request.user not in group.admins.all():
                group.admins.add(request.user)
            group.save()

            group_message = GroupMessage.objects.create(
                group=group,
                sender=None,
                message=f"System Helper: Ownership transferred to {new_owner.first_name} by {request.user.first_name}"
            )
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(group_message, context={'request': request}).data
                }
            )
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_updated",
                    "group": GroupSerializer(group, context={'request': request}).data
                }
            )

            logger.info(f"Ownership transferred to user {user_id} in group {group_id} by {request.user.id}")
            return Response({"status": "Ownership transferred successfully"}, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except User.DoesNotExist:
            logger.error(f"User {user_id} not found")
            return Response({"error": "User not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error transferring ownership for group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class UpdateGroupProfilePictureView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id):
        try:
            group = Group.objects.get(id=group_id)
            if request.user not in group.admins.all():
                logger.warning(f"User {request.user.id} attempted to update profile picture without admin rights for group {group_id}")
                return Response({"error": "Only admins can update the group profile picture"}, status=status.HTTP_403_FORBIDDEN)

            profile_picture = request.FILES.get('profile_picture')
            if not profile_picture:
                logger.warning(f"No profile picture provided for group {group_id}")
                return Response({"error": "No profile picture provided"}, status=status.HTTP_400_BAD_REQUEST)

            group.profile_picture = profile_picture
            group.save()

            group_message = GroupMessage.objects.create(
                group=group,
                sender=None,
                message=f"System Helper: Group profile picture updated by {request.user.first_name}"
            )
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(group_message, context={'request': request}).data
                }
            )
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_updated",
                    "group": GroupSerializer(group, context={'request': request}).data
                }
            )

            logger.info(f"Profile picture updated for group {group_id} by {request.user.id}")
            return Response(GroupSerializer(group, context={'request': request}).data, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error updating profile picture for group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class LeaveGroupView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id):
        try:
            group = Group.objects.get(id=group_id)
            if request.user not in group.members.all():
                logger.warning(f"User {request.user.id} is not a member of group {group_id}")
                return Response({"error": "You are not a member of this group"}, status=status.HTTP_400_BAD_REQUEST)

            if request.user == group.creator:
                logger.warning(f"User {request.user.id} attempted to leave as owner of group {group_id}")
                return Response({"error": "The group owner cannot leave the group"}, status=status.HTTP_400_BAD_REQUEST)

            group.members.remove(request.user)
            group.admins.remove(request.user)
            group.save()

            group_message = GroupMessage.objects.create(
                group=group,
                sender=None,
                message=f"System Helper: {request.user.first_name} left the group"
            )
            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(group_message, context={'request': request}).data
                }
            )
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_updated",
                    "group": GroupSerializer(group, context={'request': request}).data
                }
            )

            logger.info(f"User {request.user.id} left group {group_id}")
            return Response({"status": "You have left the group"}, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error leaving group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class DeleteGroupView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, group_id):
        try:
            group = Group.objects.get(id=group_id)
            if request.user != group.creator:
                logger.warning(f"User {request.user.id} attempted to delete group {group_id} without ownership")
                return Response({"error": "Only the group owner can delete the group"}, status=status.HTTP_403_FORBIDDEN)

            group_name = group.name
            group.delete()

            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_deleted",
                    "group_id": group_id,
                    "message": f"System Helper: Group {group_name} was deleted by {request.user.first_name}"
                }
            )

            logger.info(f"Group {group_id} deleted by {request.user.id}")
            return Response({"status": "Group deleted"}, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error deleting group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class PinMessageView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id, message_id):
        try:
            group = Group.objects.get(id=group_id)
            message = GroupMessage.objects.get(id=message_id, group=group)
            
            is_admin_or_creator = request.user in group.admins.all() or request.user == group.creator
            if not is_admin_or_creator:
                logger.warning(f"User {request.user.id} unauthorized to pin message {message_id} in group {group_id}")
                return Response({"error": "Only admins or creator can pin messages"}, status=status.HTTP_403_FORBIDDEN)

            message.is_pinned = True
            message.save()

            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(message, context={'request': request}).data
                }
            )

            logger.info(f"Message {message_id} pinned in group {group_id} by user {request.user.id}")
            return Response(GroupMessageSerializer(message, context={'request': request}).data, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except GroupMessage.DoesNotExist:
            logger.error(f"Message {message_id} not found in group {group_id}")
            return Response({"error": "Message not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error pinning message {message_id} in group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class UnpinMessageView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, group_id, message_id):
        try:
            group = Group.objects.get(id=group_id)
            message = GroupMessage.objects.get(id=message_id, group=group)
            
            is_admin_or_creator = request.user in group.admins.all() or request.user == group.creator
            if not is_admin_or_creator:
                logger.warning(f"User {request.user.id} unauthorized to unpin message {message_id} in group {group_id}")
                return Response({"error": "Only admins or creator can unpin messages"}, status=status.HTTP_403_FORBIDDEN)

            message.is_pinned = False
            message.save()

            channel_layer = get_channel_layer()
            async_to_sync(channel_layer.group_send)(
                f"group_{group_id}",
                {
                    "type": "group_message",
                    "message": GroupMessageSerializer(message, context={'request': request}).data
                }
            )

            logger.info(f"Message {message_id} unpinned in group {group_id} by user {request.user.id}")
            return Response(GroupMessageSerializer(message, context={'request': request}).data, status=status.HTTP_200_OK)
        except Group.DoesNotExist:
            logger.error(f"Group {group_id} not found")
            return Response({"error": "Group not found"}, status=status.HTTP_404_NOT_FOUND)
        except GroupMessage.DoesNotExist:
            logger.error(f"Message {message_id} not found in group {group_id}")
            return Response({"error": "Message not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error unpinning message {message_id} in group {group_id}: {str(e)}")
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)            