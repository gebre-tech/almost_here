# chat/urls.py

from django.urls import path
from .views import MessageListView

urlpatterns = [
    path('messages/', MessageListView.as_view(), name='messages'),
]
