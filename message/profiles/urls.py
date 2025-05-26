# profiles/urls.py
from django.urls import path
from .views import CreateOrUpdateProfileView, FriendProfileView, UpdateLastSeenView

urlpatterns = [
    path('profile/', CreateOrUpdateProfileView.as_view(), name='create_or_update_profile'),
    path('friend/<str:username>/', FriendProfileView.as_view(), name='friend_profile'),
    path('update_last_seen/', UpdateLastSeenView.as_view(), name='update_last_seen'),
]