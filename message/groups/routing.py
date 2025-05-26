#group chat routing
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/groups/(?P<group_id>\d+)/$', consumers.GroupChatConsumer.as_asgi()),
    re_path(r'ws/groups/$', consumers.GroupChatConsumer.as_asgi()),  # No group_id for all groups
]