# profiles/views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Profile
from authentication.models import User
from .serializers import ProfileSerializer
from rest_framework.permissions import IsAuthenticated
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from django.utils import timezone
import logging

logger = logging.getLogger(__name__)

class CreateOrUpdateProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            profile = Profile.objects.get(user=request.user)
            serializer = ProfileSerializer(profile)  # No request context needed
            logger.debug(f"GET profile serialized data: {serializer.data}")
            return Response(serializer.data)
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error in GET profile: {str(e)}", exc_info=True)
            return Response({"error": "Internal server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    def post(self, request):
        data = request.data
        try:
            logger.debug(f"Received POST data: {data}, FILES: {request.FILES}")

            # Check if profile exists
            try:
                profile = Profile.objects.get(user=request.user)
                profile.bio = data.get("bio", profile.bio)
                if "profile_picture" in request.FILES:
                    image = request.FILES["profile_picture"]
                    if image.size > 5 * 1024 * 1024:  # 5MB limit
                        return Response({"error": "Image must be under 5MB"}, status=status.HTTP_400_BAD_REQUEST)
                    if image.content_type not in ['image/jpeg', 'image/png']:
                        return Response({"error": "Only JPEG and PNG are supported"}, status=status.HTTP_400_BAD_REQUEST)
                    profile.profile_picture = image
                profile.save()
            except Profile.DoesNotExist:
                profile = Profile.objects.create(
                    user=request.user,
                    bio=data.get("bio", ""),
                    profile_picture=request.FILES.get("profile_picture", None)
                )

            # Update user fields
            user = request.user
            user.username = data.get("username", user.username)
            user.first_name = data.get("first_name", user.first_name)
            user.last_name = data.get("last_name", user.last_name)
            user.save()

            # Serialize without request context
            serializer = ProfileSerializer(profile)
            logger.debug(f"POST profile serialized data: {serializer.data}")

            # Send WebSocket update
            channel_layer = get_channel_layer()
            if channel_layer:
                profile_picture_url = serializer.data['profile_picture']
                async_to_sync(channel_layer.group_send)(
                    f"profile_{request.user.id}",
                    {
                        "type": "profile_update",
                        "username": user.username,
                        "first_name": user.first_name,
                        "last_name": user.last_name,
                        "bio": profile.bio,
                        "profile_picture": profile_picture_url,
                        "last_seen": profile.last_seen.isoformat() if profile.last_seen else None
                    }
                )
                logger.debug(f"Sent WebSocket update with profile_picture: {profile_picture_url}")
            else:
                logger.warning("Channel layer not available")

            return Response(serializer.data, status=status.HTTP_200_OK if profile.pk else status.HTTP_201_CREATED)
        
        except Exception as e:
            logger.error(f"Error in POST profile: {str(e)}", exc_info=True)
            return Response({"error": f"Internal server error: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class UpdateLastSeenView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            profile = Profile.objects.get(user=request.user)
            profile.last_seen = timezone.now()
            profile.save()
            serializer = ProfileSerializer(profile)
            logger.debug(f"UpdateLastSeen serialized data: {serializer.data}")
            
            channel_layer = get_channel_layer()
            if channel_layer:
                async_to_sync(channel_layer.group_send)(
                    f"profile_{request.user.id}",
                    {
                        "type": "last_seen_update",
                        "last_seen": profile.last_seen.isoformat()
                    }
                )
            return Response(serializer.data)
        except Profile.DoesNotExist:
            return Response({"error": "Profile not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error in UpdateLastSeen: {str(e)}", exc_info=True)
            return Response({"error": "Internal server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class FriendProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, username):
        try:
            friend = User.objects.get(username=username)
            profile = Profile.objects.get(user=friend)
            serializer = ProfileSerializer(profile)
            logger.debug(f"FriendProfile serialized data: {serializer.data}")
            return Response(serializer.data)
        except (User.DoesNotExist, Profile.DoesNotExist):
            return Response({"error": "Profile not found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            logger.error(f"Error in FriendProfileView: {str(e)}", exc_info=True)
            return Response({"error": "Internal server error"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)