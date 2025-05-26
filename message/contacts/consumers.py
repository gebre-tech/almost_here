import json
import uuid
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import FriendRequest, Contact
from authentication.models import User
from .serializers import FriendRequestSerializer, ContactSerializer
from rest_framework_simplejwt.tokens import AccessToken
from django.contrib.auth import get_user_model

User = get_user_model()

class ContactConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        token = self.scope['query_string'].decode().split('token=')[1] if 'token=' in self.scope['query_string'].decode() else None
        if not token:
            await self.close(code=4001)
            return

        try:
            access_token = AccessToken(token)
            user_id = access_token['user_id']
            self.user = await database_sync_to_async(User.objects.get)(id=user_id)
            if not self.user.is_authenticated:
                await self.close(code=4002)
                return
        except Exception as e:
            print(f"Token validation error: {str(e)}")
            await self.close(code=4003)
            return

        self.group_name = f"user_{self.user.id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        message_type = data.get('type')

        if message_type == 'friend_request':
            username = data.get('username')
            try:
                receiver = await database_sync_to_async(User.objects.get)(username=username)
                if receiver == self.user:
                    await self.send(text_data=json.dumps({
                        "type": "error",
                        "event_id": str(uuid.uuid4()),
                        "message": "You cannot send a request to yourself"
                    }))
                    return

                already_friends = await database_sync_to_async(Contact.objects.filter)(
                    user=self.user, friend=receiver
                ).aexists()
                if already_friends:
                    await self.send(text_data=json.dumps({
                        "type": "error",
                        "event_id": str(uuid.uuid4()),
                        "message": "You are already friends"
                    }))
                    return

                existing_request = await database_sync_to_async(FriendRequest.objects.filter)(
                    sender=self.user, receiver=receiver, accepted=False
                ).afirst()
                if existing_request:
                    await self.send(text_data=json.dumps({
                        "type": "error",
                        "event_id": str(uuid.uuid4()),
                        "message": "A friend request to this user is already pending."
                    }))
                    return

                reverse_request = await database_sync_to_async(FriendRequest.objects.filter)(
                    sender=receiver, receiver=self.user, accepted=False
                ).afirst()
                if reverse_request:
                    await self.send(text_data=json.dumps({
                        "type": "error",
                        "event_id": str(uuid.uuid4()),
                        "message": "You have a pending friend request from this user. Please accept or reject it first."
                    }))
                    return

                friend_request = await database_sync_to_async(FriendRequest.objects.create)(sender=self.user, receiver=receiver)
                request_data = await database_sync_to_async(FriendRequestSerializer)(friend_request).data
                event_id = str(uuid.uuid4())

                await self.channel_layer.group_send(
                    f"user_{self.user.id}",
                    {"type": "friend_request_sent", "event_id": event_id, "request": request_data}
                )
                await self.channel_layer.group_send(
                    f"user_{receiver.id}",
                    {"type": "friend_request_received", "event_id": event_id, "request": request_data}
                )
            except User.DoesNotExist:
                await self.send(text_data=json.dumps({
                    "type": "error",
                    "event_id": str(uuid.uuid4()),
                    "message": f"User '{username}' not found"
                }))

        elif message_type == 'friend_request_accepted':
            request_id = data.get('requestId')
            try:
                friend_request = await database_sync_to_async(FriendRequest.objects.get)(id=request_id, accepted=False)
                friend_request.accepted = True
                await database_sync_to_async(friend_request.save)()

                receiver_contact = await database_sync_to_async(Contact.objects.get_or_create)(
                    user=friend_request.receiver, friend=friend_request.sender
                )[0]
                sender_contact = await database_sync_to_async(Contact.objects.get_or_create)(
                    user=friend_request.sender, friend=friend_request.receiver
                )[0]

                receiver_contact_data = await database_sync_to_async(ContactSerializer)(receiver_contact, context={'request': None}).data
                sender_contact_data = await database_sync_to_async(ContactSerializer)(sender_contact, context={'request': None}).data
                event_id = str(uuid.uuid4())

                await self.channel_layer.group_send(
                    f"user_{friend_request.sender.id}",
                    {
                        "type": "friend_request_accepted",
                        "event_id": event_id,
                        "requestId": request_id,
                        "friend_first_name": friend_request.receiver.first_name,
                        "contact": sender_contact_data
                    }
                )
                await self.channel_layer.group_send(
                    f"user_{friend_request.receiver.id}",
                    {
                        "type": "friend_request_accepted",
                        "event_id": event_id,
                        "requestId": request_id,
                        "friend_first_name": friend_request.sender.first_name,
                        "contact": receiver_contact_data
                    }
                )
            except FriendRequest.DoesNotExist:
                await self.send(text_data=json.dumps({
                    "type": "error",
                    "event_id": str(uuid.uuid4()),
                    "message": "Friend request not found or already processed"
                }))

        elif message_type == 'friend_request_rejected':
            request_id = data.get('requestId')
            try:
                friend_request = await database_sync_to_async(FriendRequest.objects.get)(id=request_id, accepted=False)
                sender_id = friend_request.sender.id
                sender_first_name = friend_request.sender.first_name
                receiver_first_name = friend_request.receiver.first_name
                await database_sync_to_async(friend_request.delete)()
                event_id = str(uuid.uuid4())

                await self.channel_layer.group_send(
                    f"user_{sender_id}",
                    {
                        "type": "friend_request_rejected",
                        "event_id": event_id,
                        "requestId": request_id,
                        "rejected_by": receiver_first_name
                    }
                )
                await self.channel_layer.group_send(
                    f"user_{self.user.id}",
                    {
                        "type": "friend_request_rejected",
                        "event_id": event_id,
                        "requestId": request_id,
                        "rejected_user": sender_first_name
                    }
                )
            except FriendRequest.DoesNotExist:
                await self.send(text_data=json.dumps({
                    "type": "error",
                    "event_id": str(uuid.uuid4()),
                    "message": "Friend request not found or already processed"
                }))

    async def friend_request_received(self, event):
        await self.send(text_data=json.dumps(event))

    async def friend_request_sent(self, event):
        await self.send(text_data=json.dumps(event))

    async def friend_request_accepted(self, event):
        await self.send(text_data=json.dumps(event))

    async def friend_request_rejected(self, event):
        await self.send(text_data=json.dumps(event))

    async def friend_removed(self, event):
        await self.send(text_data=json.dumps(event))