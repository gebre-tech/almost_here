# chat/routing.py
from django.urls import re_path
from .consumers import ChatConsumer, GlobalConsumer  # Import the new consumer

websocket_urlpatterns = [
    re_path(r'ws/chat/(?P<sender_id>\d+)/(?P<receiver_id>\d+)/$', ChatConsumer.as_asgi()),
    re_path(r'ws/global/$', GlobalConsumer.as_asgi()),  # Add the global route
]