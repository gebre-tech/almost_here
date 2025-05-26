from channels.generic.websocket import AsyncWebsocketConsumer
from django.utils.timezone import now
from .models import User

class OnlineStatusConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.user = self.scope["user"]
        if self.user.is_authenticated:
            User.objects.filter(user=self.user).update(last_seen=now())
        await self.accept()

    async def disconnect(self, close_code):
        if self.user.is_authenticated:
            User.objects.filter(user=self.user).update(last_seen=now())
