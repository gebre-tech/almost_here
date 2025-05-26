from rest_framework import serializers
from .models import Group, GroupMessage
from authentication.models import User

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'first_name', 'username']

class GroupSerializer(serializers.ModelSerializer):
    creator = UserSerializer(read_only=True)
    admins = UserSerializer(read_only=True, many=True)
    members = UserSerializer(read_only=True, many=True)
    profile_picture = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    unread_count = serializers.IntegerField(read_only=True)  # Fixed typo: read만 -> read_only

    def get_profile_picture(self, obj):
        if obj.profile_picture:
            request = self.context.get('request')
            return request.build_absolute_uri(obj.profile_picture.url) if request else obj.profile_picture.url
        return None

    def get_last_message(self, obj):
        if hasattr(obj, 'last_message') and obj.last_message:
            return GroupMessageSerializer(obj.last_message[0]).data
        return None

    class Meta:
        model = Group
        fields = ['id', 'name', 'creator', 'admins', 'members', 'created_at', 
                 'profile_picture', 'last_message', 'unread_count']
class GroupMessageSerializer(serializers.ModelSerializer):
    sender = serializers.SerializerMethodField()
    group = serializers.SerializerMethodField()
    attachment = serializers.FileField(required=False, allow_null=True)
    file_url = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    reactions = serializers.JSONField(default=dict)
    read_by = UserSerializer(many=True, read_only=True)
    parent_message = serializers.SerializerMethodField()
    is_pinned = serializers.BooleanField(read_only=True)

    def get_sender(self, obj):
        if obj.sender is None:
            return {
                "id": None,
                "first_name": "System Helper",
                "username": "system"
            }
        return {
            "id": obj.sender.id,
            "first_name": obj.sender.first_name,
            "username": obj.sender.username
        }

    def get_group(self, obj):
        return {"id": obj.group.id, "name": obj.group.name}

    def get_file_url(self, obj):
        if obj.attachment:
            request = self.context.get('request')
            return request.build_absolute_uri(obj.attachment.url) if request else obj.attachment.url
        return None

    def get_file_size(self, obj):
        if obj.attachment and obj.attachment.file:
            try:
                return obj.attachment.size
            except (AttributeError, OSError):
                return None
        return None

    def get_parent_message(self, obj):
        if obj.parent_message:
            return {
                "id": obj.parent_message.id,
                "message": obj.parent_message.message,
                "sender": self.get_sender(obj.parent_message)
            }
        return None

    class Meta:
        model = GroupMessage
        fields = ['id', 'group', 'sender', 'message', 'attachment', 'file_name', 'file_type', 
                  'file_url', 'file_size', 'timestamp', 'reactions', 'read_by', 'parent_message', 'is_pinned']