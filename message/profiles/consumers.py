# profiles/consumers.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone
from .models import Profile
from authentication.models import User
from rest_framework_simplejwt.tokens import AccessToken
import logging

logger = logging.getLogger(__name__)

class ProfileConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        token = self.scope['query_string'].decode().split('token=')[1] if 'token=' in self.scope['query_string'].decode() else None
        if not token:
            logger.warning("No token provided in WebSocket connection")
            await self.close(code=4001)
            return

        try:
            access_token = AccessToken(token)
            user_id = access_token['user_id']
            self.user = await database_sync_to_async(User.objects.get)(id=user_id)
            if not self.user.is_authenticated:
                logger.warning(f"User {user_id} not authenticated")
                await self.close(code=4002)
                return
        except Exception as e:
            logger.error(f"Token validation error: {str(e)}")
            await self.close(code=4003)
            return

        self.group_name = f"profile_{self.user.id}"
        logger.info(f"WebSocket connected for user {self.user.username} (id={self.user.id})")
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        logger.info(f"WebSocket disconnected for group {self.group_name}, code={close_code}")
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
            action = data.get('type')
            logger.debug(f"Received WebSocket message: {data}")
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in WebSocket message: {str(e)}")
            return

        if action == 'update_last_seen':
            await self.handle_update_last_seen()
        elif action == 'update_profile':
            await self.handle_update_profile(data)

    @database_sync_to_async
    def _update_last_seen_db(self):
        profile, created = Profile.objects.get_or_create(user=self.user)
        profile.last_seen = timezone.now()
        profile.save()
        logger.debug(f"Updated last_seen for user {self.user.username} to {profile.last_seen}")
        return profile.last_seen.isoformat()

    @database_sync_to_async
    def _update_profile_db(self, data):
        profile = Profile.objects.get(user=self.user)
        user = profile.user
        user.username = data.get('username', user.username)
        user.first_name = data.get('first_name', user.first_name)
        user.last_name = data.get('last_name', user.last_name)
        user.save()
        profile.bio = data.get('bio', profile.bio)
        profile.save()
        logger.info(f"Updated profile for user {user.username}")

        from .serializers import ProfileSerializer
        serializer = ProfileSerializer(profile)  # No request context needed
        profile_picture_url = serializer.data['profile_picture']

        return {
            'username': user.username,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'bio': profile.bio,
            'profile_picture': profile_picture_url,
            'last_seen': profile.last_seen.isoformat() if profile.last_seen else None
        }

    async def handle_update_last_seen(self):
        last_seen = await self._update_last_seen_db()
        await self.channel_layer.group_send(
            self.group_name,
            {
                'type': 'last_seen_update',
                'last_seen': last_seen
            }
        )

    async def handle_update_profile(self, data):
        updated_data = await self._update_profile_db(data)
        await self.channel_layer.group_send(
            self.group_name,
            {
                'type': 'profile_update',
                'username': updated_data['username'],
                'first_name': updated_data['first_name'],
                'last_name': updated_data['last_name'],
                'bio': updated_data['bio'],
                'profile_picture': updated_data['profile_picture'],
                'last_seen': updated_data['last_seen']
            }
        )

    async def profile_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'profile_update',
            'username': event['username'],
            'first_name': event['first_name'],
            'last_name': event['last_name'],
            'bio': event['bio'],
            'profile_picture': event['profile_picture'],
            'last_seen': event['last_seen']
        }))

    async def last_seen_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'last_seen_update',
            'last_seen': event['last_seen']
        }))