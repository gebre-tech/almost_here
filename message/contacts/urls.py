from django.urls import path
from .views import (
    SendFriendRequestView, GetFriendRequestsView, AcceptFriendRequestView,
    RejectFriendRequestView, GetContactsView, SearchContactsView, SearchUsersView,
    SentFriendRequestsView, AddFriendView, RemoveFriendView, GetContactsWithProfilesView
)

urlpatterns = [
    path('request/', SendFriendRequestView.as_view(), name='send_friend_request'),
    path('requests/', GetFriendRequestsView.as_view(), name='get_friend_requests'),
    path('sent_requests/', SentFriendRequestsView.as_view(), name='sent_friend_requests'),
    path('accept/<int:request_id>/', AcceptFriendRequestView.as_view(), name='accept_friend_request'),
    path('reject/<int:request_id>/', RejectFriendRequestView.as_view(), name='reject_friend_request'),
    path('list/', GetContactsView.as_view(), name='get_contacts'),
    path('list_with_profiles/', GetContactsWithProfilesView.as_view(), name='get_contacts_with_profiles'),
    path('search/', SearchContactsView.as_view(), name='search_contacts'),
    path('search/users/', SearchUsersView.as_view(), name='search_users'),
    path('add/', AddFriendView.as_view(), name='add_friend'),
    path('remove/<int:friend_id>/', RemoveFriendView.as_view(), name='remove_friend'),  # Fixed 'views.' to direct import
]