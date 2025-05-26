# chat/views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth import get_user_model
from django.db.models import Q
from .models import Message
from .serializers import MessageSerializer
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework.permissions import IsAuthenticated

User = get_user_model()

class MessageListView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        """Retrieve all messages between sender and receiver."""
        sender_id = request.query_params.get('sender')
        receiver_id = request.query_params.get('receiver')

        if not sender_id or not receiver_id:
            return Response({"error": "Sender and Receiver IDs are required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            messages = Message.objects.filter(
                (Q(sender_id=sender_id) & Q(receiver_id=receiver_id)) |
                (Q(sender_id=receiver_id) & Q(receiver_id=sender_id))
            ).order_by('created_at')
            serializer = MessageSerializer(messages, many=True, context={'request': request})
            return Response(serializer.data)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    def post(self, request):
        """Send a message and retrieve the full conversation between sender and receiver."""
        serializer = MessageSerializer(data=request.data, context={'request': request})
        if serializer.is_valid():
            sender_id = request.data.get("sender")
            receiver_id = request.data.get("receiver")
            nonce = request.data.get("nonce")

            if not sender_id or not receiver_id:
                return Response({"error": "Sender and Receiver IDs are required."}, status=status.HTTP_400_BAD_REQUEST)

            sender = User.objects.get(id=sender_id)
            receiver = User.objects.get(id=receiver_id)

            message_data = {
                'sender': sender,
                'receiver': receiver,
                'content': serializer.validated_data['content'],
            }
            if 'file' in serializer.validated_data:
                message_data['file'] = serializer.validated_data['file']
                message_data['file_name'] = serializer.validated_data.get('file_name')
                message_data['file_type'] = serializer.validated_data.get('file_type')
            if nonce is not None:
                message_data['nonce'] = nonce

            Message.objects.create(**message_data)

            messages = Message.objects.filter(
                (Q(sender_id=sender_id) & Q(receiver_id=receiver_id)) |
                (Q(sender_id=receiver_id) & Q(receiver_id=sender_id))
            ).order_by('created_at')

            all_messages_serializer = MessageSerializer(messages, many=True, context={'request': request})
            return Response(all_messages_serializer.data, status=status.HTTP_201_CREATED)

        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def put(self, request):
        """Edit a message."""
        message_id = request.data.get('message_id')
        if not message_id:
            return Response({"error": "message_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            message = Message.objects.get(message_id=message_id)
            if message.sender_id != request.user.id:
                return Response({"error": "Not authorized to edit this message"}, status=status.HTTP_403_FORBIDDEN)

            serializer = MessageSerializer(message, data=request.data, partial=True, context={'request': request})
            if serializer.is_valid():
                serializer.save()
                return Response(serializer.data)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        except Message.DoesNotExist:
            return Response({"error": "Message not found"}, status=status.HTTP_404_NOT_FOUND)

    def delete(self, request):
        """Delete a message."""
        message_id = request.query_params.get('message_id')
        if not message_id:
            return Response({"error": "message_id is required"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            message = Message.objects.get(message_id=message_id)
            if message.sender_id != request.user.id:
                return Response({"error": "Not authorized to delete this message"}, status=status.HTTP_403_FORBIDDEN)

            if message.file:
                message.file.delete()
            message.delete()
            return Response({"message": "Message deleted"}, status=status.HTTP_204_NO_CONTENT)
        except Message.DoesNotExist:
            return Response({"error": "Message not found"}, status=status.HTTP_404_NOT_FOUND)