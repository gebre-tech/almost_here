from django.urls import path, re_path
from . import views, consumers

urlpatterns = [
    path('create/', views.CreateGroupView.as_view(), name='create_group'),
    path('message/send/', views.SendGroupMessageView.as_view(), name='send_group_message'),
    path('messages/<int:group_id>/', views.GetGroupMessagesView.as_view(), name='get_group_messages'),
    path('message/edit/<int:group_id>/<int:message_id>/', views.EditGroupMessageView.as_view(), name='edit_group_message'),
    path('message/delete/<int:group_id>/<int:message_id>/', views.DeleteGroupMessageView.as_view(), name='delete_group_message'),
    path('message/pin/<int:group_id>/<int:message_id>/', views.PinMessageView.as_view(), name='pin_message'),
    path('message/unpin/<int:group_id>/<int:message_id>/', views.UnpinMessageView.as_view(), name='unpin_message'),
    path('add_member/<int:group_id>/<int:user_id>/', views.AddMemberToGroupView.as_view(), name='add_member_to_group'),
    path('remove_member/<int:group_id>/<int:user_id>/', views.RemoveMemberFromGroupView.as_view(), name='remove_member_from_group'),
    path('list/', views.GroupListView.as_view(), name='list_groups'),
    path('update_profile_picture/<int:group_id>/', views.UpdateGroupProfilePictureView.as_view(), name='update_group_profile_picture'),
    path('details/<int:group_id>/', views.GroupDetailsView.as_view(), name='group_details'),
    path('assign_admin/<int:group_id>/<int:user_id>/', views.AssignAdminView.as_view(), name='assign_admin'),
    path('revoke_admin/<int:group_id>/<int:user_id>/', views.RevokeAdminView.as_view(), name='revoke_admin'),
    path('leave/<int:group_id>/', views.LeaveGroupView.as_view(), name='leave_group'),
    path('delete/<int:group_id>/', views.DeleteGroupView.as_view(), name='delete_group'),
    path('transfer_ownership/<int:group_id>/<int:user_id>/', views.TransferOwnershipView.as_view(), name='transfer_ownership'),
]

websocket_urlpatterns = [
    re_path(r'ws/groups/(?P<group_id>\d+)/$', consumers.GroupChatConsumer.as_asgi(), name='group_chat'),
    re_path(r'ws/groups/$', consumers.GroupChatConsumer.as_asgi(), name='all_groups_chat'),
]