# contacts/serializers.py
from rest_framework import serializers
from .models import Contact, FriendRequest
from profiles.serializers import ProfileSerializer, UserSerializer  # Import from profiles

class FriendRequestSerializer(serializers.ModelSerializer):
    sender = UserSerializer(read_only=True)
    receiver = UserSerializer(read_only=True)

    class Meta:
        model = FriendRequest
        fields = ['id', 'sender', 'receiver', 'created_at', 'accepted']

class ContactSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    friend = serializers.SerializerMethodField()
    friend_id = serializers.IntegerField(source='friend.id', read_only=True)

    class Meta:
        model = Contact
        fields = ['id', 'user', 'friend', 'friend_id', 'created_at']
        read_only_fields = ['user', 'created_at']

    def get_friend(self, obj):
        # Use ProfileSerializer to get friend data including user and profile details
        try:
            profile = ProfileSerializer(obj.friend.profile, context=self.context).data
            return profile
        except AttributeError:
            # If no profile exists, return basic user data with null profile fields
            user_data = UserSerializer(obj.friend, context=self.context).data
            return {
                'user': user_data,
                'bio': None,
                'profile_picture': None,
                'last_seen': None
            }