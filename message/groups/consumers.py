import json
import re
import uuid
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from .models import Group, GroupMessage
from authentication.models import User
from .serializers import GroupMessageSerializer, GroupSerializer
from rest_framework_simplejwt.tokens import AccessToken, TokenError
from django.core.files.base import ContentFile
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

class GroupChatConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.pending_metadata = None
        self.group_channels = []

    async def connect(self):
        query_string = self.scope['query_string'].decode()
        token = query_string.split('token=')[1] if 'token=' in query_string else None
        if not token:
            logger.warning("WebSocket connection rejected: No token provided")
            await self.close(code=4001)
            return

        try:
            access_token = AccessToken(token)
            user_id = access_token['user_id']
            self.user = await database_sync_to_async(User.objects.get)(id=user_id)
            if not self.user.is_authenticated:
                logger.warning(f"WebSocket connection rejected: User {user_id} not authenticated")
                await self.close(code=4002)
                return
        except TokenError as e:
            logger.error(f"Token validation error: {str(e)}")
            await self.close(code=4003)
            return
        except User.DoesNotExist:
            logger.error(f"User {user_id} not found")
            await self.close(code=4003)
            return

        self.group_id = self.scope['url_route']['kwargs'].get('group_id')
        self.group_channels = []

        if self.group_id:
            try:
                is_member = await database_sync_to_async(lambda: Group.objects.filter(
                    id=self.group_id, members=self.user
                ).exists())()
                if not is_member:
                    logger.warning(f"User {self.user.id} is not a member of group {self.group_id}")
                    await self.close(code=4004)
                    return
                group_channel = f"group_{self.group_id}"
                if not self._is_valid_group_name(group_channel):
                    logger.error(f"Invalid group channel name: {group_channel}")
                    await self.close(code=4006)
                    return
                self.group_channels = [group_channel]
            except Exception as e:
                logger.error(f"Error checking group membership for group {self.group_id}: {str(e)}")
                await self.close(code=4007)
                return
        else:
            self.groups = await self.get_user_groups()
            if not self.groups:
                logger.info(f"User {self.user.id} is not a member of any groups")
                await self.accept()
                await self.send(text_data=json.dumps({
                    "type": "info",
                    "event_id": str(uuid.uuid4()),
                    "message": "You haven't joined any groups"
                }))
                return
            self.group_channels = []
            for group in self.groups:
                group_channel = f"group_{group.id}"
                if self._is_valid_group_name(group_channel):
                    self.group_channels.append(group_channel)
                else:
                    logger.warning(f"Skipping invalid group channel name: {group_channel}")

        for group_channel in self.group_channels:
            await self.channel_layer.group_add(group_channel, self.channel_name)

        await self.accept()
        logger.info(f"GroupChatConsumer connected for user {self.user.id} to groups: {self.group_channels}")
    @database_sync_to_async
    def get_user_groups(self):
        return list(Group.objects.filter(members=self.user))

    def _is_valid_group_name(self, name):
        if not isinstance(name, str):
            return False
        if len(name) >= 100:
            return False
        pattern = r'^[a-zA-Z0-9\-_\.]+$'
        return bool(re.match(pattern, name))

    async def disconnect(self, close_code):
        for group_channel in self.group_channels:
            if self._is_valid_group_name(group_channel):
                await self.channel_layer.group_discard(group_channel, self.channel_name)
            else:
                logger.warning(f"Cannot discard invalid group channel name: {group_channel}")
        logger.info(f"GroupChatConsumer disconnected for user {self.user.id} with code {close_code}")

    @database_sync_to_async
    def has_edit_delete_permission(self, group, user, message):
        """Check if user can edit/delete a message."""
        try:
            is_admin = group.admins.filter(id=user.id).exists()
            is_creator = group.creator_id == user.id
            is_sender = message.sender_id == user.id if message.sender_id else False
            logger.debug(f"Permission check: user={user.id}, sender_id={message.sender_id}, is_admin={is_admin}, is_creator={is_creator}, is_sender={is_sender}")
            return is_sender or is_admin or is_creator
        except Exception as e:
            logger.error(f"Error in has_edit_delete_permission: {str(e)}", exc_info=True)
            return False

    async def receive(self, text_data=None, bytes_data=None):
        if text_data:
            try:
                data = json.loads(text_data)
                message_type = data.get('type')
                group_id = data.get('group_id', self.group_id)
                logger.debug(f"Processing message type '{message_type}' for user {self.user.id} in group {group_id}")

                if not group_id:
                    await self.send(text_data=json.dumps({
                        "type": "error",
                        "event_id": str(uuid.uuid4()),
                        "message": "No group_id provided"
                    }))
                    return

                group = await database_sync_to_async(lambda: Group.objects.select_related('creator').prefetch_related('admins', 'members').get(id=group_id))()
                group_channel = f"group_{group_id}"
                if not self._is_valid_group_name(group_channel):
                    await self.send(text_data=json.dumps({
                        "type": "error",
                        "event_id": str(uuid.uuid4()),
                        "message": "Invalid group channel name"
                    }))
                    return

                if message_type == 'group_message':
                    message = data.get('message')
                    parent_message_id = data.get('parent_message_id')  # For replies
                    self.pending_metadata = data if not message else None

                    if message:
                        kwargs = {
                            'group': group,
                            'sender': self.user,
                            'message': message
                        }
                        if parent_message_id:
                            try:
                                parent_message = await database_sync_to_async(GroupMessage.objects.get)(id=parent_message_id, group=group)
                                kwargs['parent_message'] = parent_message
                            except GroupMessage.DoesNotExist:
                                await self.send(text_data=json.dumps({
                                    "type": "error",
                                    "event_id": str(uuid.uuid4()),
                                    "message": "Parent message not found"
                                }))
                                return

                        group_message = await database_sync_to_async(GroupMessage.objects.create)(**kwargs)
                        await database_sync_to_async(group_message.read_by.add)(self.user)
                        message_data = await database_sync_to_async(lambda: GroupMessageSerializer(group_message, context={'request': None}).data)()
                        event_id = str(uuid.uuid4())
                        await self.channel_layer.group_send(
                            group_channel,
                            {
                                "type": "group_message",
                                "event_id": event_id,
                                "message": message_data
                            }
                        )
                        await self.broadcast_group_update(group, group_channel)

                elif message_type == 'edit_message':
                    message_id = data.get('message_id')
                    new_message = data.get('new_message')
                    try:
                        group_message = await database_sync_to_async(
                            lambda: GroupMessage.objects.select_related('sender').get(id=message_id, group=group)
                        )()
                        has_permission = await self.has_edit_delete_permission(group, self.user, group_message)
                        if not has_permission:
                            await self.send(text_data=json.dumps({
                                "type": "error",
                                "event_id": str(uuid.uuid4()),
                                "message": "You are not authorized to edit this message"
                            }))
                            return
                        group_message.message = new_message
                        await database_sync_to_async(group_message.save)()
                        message_data = await database_sync_to_async(
                            lambda: GroupMessageSerializer(group_message, context={'request': None}).data
                        )()
                        event_id = str(uuid.uuid4())
                        await self.channel_layer.group_send(
                            group_channel,
                            {
                                "type": "group_message",
                                "event_id": event_id,
                                "message": message_data
                            }
                        )
                    except GroupMessage.DoesNotExist:
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": "Message not found"
                        }))
                        return
                    except Exception as e:
                        logger.error(f"Error in edit_message for message_id={message_id}: {str(e)}", exc_info=True)
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": f"Failed to edit message: {str(e)}"
                        }))

                elif message_type == 'delete_message':
                    message_id = data.get('message_id')
                    try:
                        group_message = await database_sync_to_async(
                            lambda: GroupMessage.objects.select_related('sender').get(id=message_id, group=group)
                        )()
                        has_permission = await self.has_edit_delete_permission(group, self.user, group_message)
                        if not has_permission:
                            await self.send(text_data=json.dumps({
                                "type": "error",
                                "event_id": str(uuid.uuid4()),
                                "message": "You are not authorized to delete this message"
                            }))
                            return
                        sender_first_name = group_message.sender.first_name if group_message.sender else "System"
                        sender_id = group_message.sender_id
                        await database_sync_to_async(group_message.delete)()
                        event_id = str(uuid.uuid4())
                        # Notify all group members, mirroring RemoveFriendView
                        await self.channel_layer.group_send(
                            group_channel,
                            {
                                "type": "group_message_deleted",
                                "event_id": event_id,
                                "message_id": message_id,
                                "sender_id": sender_id,
                                "sender_first_name": sender_first_name,
                                "deleted_by": self.user.first_name,
                                "message": f"Message deleted by {self.user.first_name}"
                            }
                        )
                        # Optionally notify sender individually if not in group
                        if sender_id and sender_id != self.user.id:
                            await self.channel_layer.group_send(
                                f"user_{sender_id}",
                                {
                                    "type": "group_message_deleted",
                                    "event_id": event_id,
                                    "message_id": message_id,
                                    "group_id": group_id,
                                    "sender_first_name": sender_first_name,
                                    "deleted_by": self.user.first_name,
                                    "message": f"Your message in group {group.name} was deleted by {self.user.first_name}"
                                }
                            )
                        logger.info(f"Message {message_id} deleted by user {self.user.id} in group {group_id}")
                    except GroupMessage.DoesNotExist:
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": "Message not found"
                        }))
                        return
                    except Exception as e:
                        logger.error(f"Error in delete_message for message_id={message_id}: {str(e)}", exc_info=True)
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": f"Failed to delete message: {str(e)}"
                        }))

                elif message_type == 'pin_message':
                    message_id = data.get('message_id')
                    is_admin_or_creator = await database_sync_to_async(
                        lambda: group.admins.filter(id=self.user.id).exists() or group.creator_id == self.user.id
                    )()
                    if not is_admin_or_creator:
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": "Only admins or creator can pin messages"
                        }))
                        return
                    try:
                        group_message = await database_sync_to_async(GroupMessage.objects.get)(id=message_id, group=group)
                        group_message.is_pinned = True
                        await database_sync_to_async(group_message.save)()
                        message_data = await database_sync_to_async(
                            lambda: GroupMessageSerializer(group_message, context={'request': None}).data
                        )()
                        event_id = str(uuid.uuid4())
                        await self.channel_layer.group_send(
                            group_channel,
                            {
                                "type": "group_message",
                                "event_id": event_id,
                                "message": message_data
                            }
                        )
                    except GroupMessage.DoesNotExist:
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": "Message not found"
                        }))
                        return

                elif message_type == 'unpin_message':
                    message_id = data.get('message_id')
                    is_admin_or_creator = await database_sync_to_async(
                        lambda: group.admins.filter(id=self.user.id).exists() or group.creator_id == self.user.id
                    )()
                    if not is_admin_or_creator:
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": "Only admins or creator can unpin messages"
                        }))
                        return
                    try:
                        group_message = await database_sync_to_async(GroupMessage.objects.get)(id=message_id, group=group)
                        group_message.is_pinned = False
                        await database_sync_to_async(group_message.save)()
                        message_data = await database_sync_to_async(
                            lambda: GroupMessageSerializer(group_message, context={'request': None}).data
                        )()
                        event_id = str(uuid.uuid4())
                        await self.channel_layer.group_send(
                            group_channel,
                            {
                                "type": "group_message",
                                "event_id": event_id,
                                "message": message_data
                            }
                        )
                    except GroupMessage.DoesNotExist:
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": "Message not found"
                        }))
                        return

                elif message_type == 'reaction':
                    message_id = data.get('message_id')
                    reaction = data.get('reaction')
                    try:
                        group_message = await database_sync_to_async(GroupMessage.objects.get)(id=message_id)
                        reactions = group_message.reactions or {}
                        reactions[str(self.user.id)] = reaction
                        group_message.reactions = reactions
                        await database_sync_to_async(group_message.save)()
                        message_data = await database_sync_to_async(
                            lambda: GroupMessageSerializer(group_message, context={'request': None}).data
                        )()
                        event_id = str(uuid.uuid4())
                        await self.channel_layer.group_send(
                            group_channel,
                            {
                                "type": "group_message",
                                "event_id": event_id,
                                "message": message_data
                            }
                        )
                    except GroupMessage.DoesNotExist:
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": "Message not found"
                        }))
                        return

                elif message_type == 'read_receipt':
                    message_id = data.get('message_id')
                    try:
                        group_message = await database_sync_to_async(GroupMessage.objects.get)(id=message_id)
                        await database_sync_to_async(group_message.read_by.add)(self.user)
                        message_data = await database_sync_to_async(
                            lambda: GroupMessageSerializer(group_message, context={'request': None}).data
                        )()
                        event_id = str(uuid.uuid4())
                        await self.channel_layer.group_send(
                            group_channel,
                            {
                                "type": "read_receipt",
                                "event_id": event_id,
                                "message": message_data
                            }
                        )
                    except GroupMessage.DoesNotExist:
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": "Message not found"
                        }))
                        return

                elif message_type == 'typing':
                    event_id = str(uuid.uuid4())
                    await self.channel_layer.group_send(
                        group_channel,
                        {
                            "type": "typing",
                            "event_id": event_id,
                            "user_id": self.user.id,
                            "first_name": self.user.first_name,
                        }
                    )

                elif message_type == 'delete_group':
                    is_creator = await database_sync_to_async(lambda: group.creator_id == self.user.id)()
                    if not is_creator:
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": "Only the group owner can delete the group"
                        }))
                        return
                    await database_sync_to_async(group.delete)()
                    event_id = str(uuid.uuid4())
                    await self.channel_layer.group_send(
                        group_channel,
                        {
                            "type": "group_deleted",
                            "event_id": event_id,
                            "group_id": group_id,
                            "message": f"System Helper: Group {group.name} was deleted by {self.user.first_name}"
                        }
                    )

            except json.JSONDecodeError:
                logger.error(f"Invalid JSON data received for user {self.user.id}: {text_data}")
                await self.send(text_data=json.dumps({
                    "type": "error",
                    "event_id": str(uuid.uuid4()),
                    "message": "Invalid JSON data"
                }))
            except Exception as e:
                logger.error(f"Error processing text data for user {self.user.id}, message_type={message_type}: {str(e)}", exc_info=True)
                await self.send(text_data=json.dumps({
                    "type": "error",
                    "event_id": str(uuid.uuid4()),
                    "message": f"Failed to process text data: {str(e)}"
                }))

        if bytes_data and self.pending_metadata:
            try:
                metadata = self.pending_metadata
                file_name = metadata.get('file_name', f"unnamed_file_{datetime.now().timestamp()}")
                file_type = metadata.get('file_type', 'application/octet-stream')
                group_id = metadata.get('group_id', self.group_id)
                parent_message_id = metadata.get('parent_message_id')  # For replies

                if not group_id:
                    await self.send(text_data=json.dumps({
                        "type": "error",
                        "event_id": str(uuid.uuid4()),
                        "message": "No group_id provided"
                    }))
                    return

                group = await database_sync_to_async(lambda: Group.objects.get(id=group_id))()
                group_channel = f"group_{group_id}"
                if not self._is_valid_group_name(group_channel):
                    await self.send(text_data=json.dumps({
                        "type": "error",
                        "event_id": str(uuid.uuid4()),
                        "message": "Invalid group channel name"
                    }))
                    return

                max_size = 10 * 1024 * 1024  # 10MB
                if len(bytes_data) > max_size:
                    await self.send(text_data=json.dumps({
                        "type": "error",
                        "event_id": str(uuid.uuid4()),
                        "message": "File size exceeds 10MB limit"
                    }))
                    return

                kwargs = {
                    'group': group,
                    'sender': self.user,
                    'file_name': file_name,
                    'file_type': file_type
                }
                if parent_message_id:
                    try:
                        parent_message = await database_sync_to_async(GroupMessage.objects.get)(id=parent_message_id, group=group)
                        kwargs['parent_message'] = parent_message
                    except GroupMessage.DoesNotExist:
                        await self.send(text_data=json.dumps({
                            "type": "error",
                            "event_id": str(uuid.uuid4()),
                            "message": "Parent message not found"
                        }))
                        return

                group_message = await database_sync_to_async(GroupMessage.objects.create)(**kwargs)
                await database_sync_to_async(group_message.attachment.save)(file_name, ContentFile(bytes_data))
                await database_sync_to_async(group_message.read_by.add)(self.user)

                message_data = await database_sync_to_async(
                    lambda: GroupMessageSerializer(group_message, context={'request': None}).data
                )()
                event_id = str(uuid.uuid4())
                await self.channel_layer.group_send(
                    group_channel,
                    {
                        "type": "group_message",
                        "event_id": event_id,
                        "message": message_data
                    }
                )
                await self.broadcast_group_update(group, group_channel)
                self.pending_metadata = None
            except Exception as e:
                logger.error(f"Error processing file for user {self.user.id}: {str(e)}", exc_info=True)
                await self.send(text_data=json.dumps({
                    "type": "error",
                    "event_id": str(uuid.uuid4()),
                    "message": f"Failed to process file: {str(e)}"
                }))
                self.pending_metadata = None

    async def group_message(self, event):
        await self.send(text_data=json.dumps({
            "type": "group_message",
            "event_id": event['event_id'],
            "message": event['message']
        }))

    async def group_message_deleted(self, event):
        await self.send(text_data=json.dumps({
            "type": "group_message_deleted",
            "event_id": event['event_id'],
            "message_id": event['message_id'],
            "sender_id": event['sender_id'],
            "sender_first_name": event['sender_first_name'],
            "deleted_by": event['deleted_by'],
            "message": event['message'],
            "group_id": event.get('group_id')  # Optional for sender notification
        }))

    async def read_receipt(self, event):
        await self.send(text_data=json.dumps({
            "type": "read_receipt",
            "event_id": event['event_id'],
            "message": event['message']
        }))

    async def typing(self, event):
        await self.send(text_data=json.dumps({
            "type": "typing",
            "event_id": event['event_id'],
            "user_id": event['user_id'],
            "first_name": event['first_name']
        }))

    async def group_deleted(self, event):
        await self.send(text_data=json.dumps({
            "type": "group_deleted",
            "event_id": event['event_id'],
            "group_id": event['group_id'],
            "message": event['message']
        }))

    async def group_updated(self, event):
        await self.send(text_data=json.dumps({
            "type": "group_updated",
            "event_id": event['event_id'],
            "group": event['group']
        }))

    @database_sync_to_async
    def serialize_group(self, group):
        return GroupSerializer(group, context={'request': None}).data

    async def broadcast_group_update(self, group, group_channel):
        try:
            group_data = await self.serialize_group(group)
            event_id = str(uuid.uuid4())
            await self.channel_layer.group_send(
                group_channel,
                {
                    "type": "group_updated",
                    "event_id": event_id,
                    "group": group_data
                }
            )
        except Exception as e:
            logger.error(f"Error broadcasting group update for group {group.id}: {str(e)}", exc_info=True)