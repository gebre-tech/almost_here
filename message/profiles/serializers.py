# profiles/serializers.py
from rest_framework import serializers
from .models import Profile
from authentication.models import User

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['username', 'first_name', 'last_name']

class ProfileSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    profile_picture = serializers.SerializerMethodField()

    def get_profile_picture(self, obj):
        if obj.profile_picture:
            # Always return the absolute URL based on the file path
            from django.conf import settings
            base_url = settings.SITE_URL.rstrip('/')  # e.g., 'http://127.0.0.1:8000'
            relative_url = obj.profile_picture.url  # e.g., '/media/profile_pics/profile_MQw2SEI.jpg'
            return f"{base_url}{relative_url}"
        return None

    class Meta:
        model = Profile
        fields = ['user', 'bio', 'profile_picture', 'last_seen']