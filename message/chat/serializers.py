# chat/serializers.py
from rest_framework import serializers
from .models import Message

class MessageSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = [
            'message_id', 'sender', 'receiver', 'content', 'file', 'file_name',
            'file_type', 'file_size', 'created_at', 'updated_at', 'is_edited',
            'file_url', 'nonce', 'ephemeral_key', 'message_key', 'type'
        ]

    def create(self, validated_data):
        return Message.objects.create(**validated_data)

    def update(self, instance, validated_data):
        instance.content = validated_data.get('content', instance.content)
        instance.is_edited = True
        instance.save()
        return instance

    def get_file_url(self, obj):
        if obj.file:
            request = self.context.get('request')
            return request.build_absolute_uri(obj.file.url) if request else obj.file.url
        return None