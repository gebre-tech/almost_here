from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from authentication.models import User
from authentication.serializers import RegisterSerializer, LoginSerializer, UserSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from django.core.mail import send_mail
from django.conf import settings

class RegisterView(APIView):
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class LoginView(APIView):
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        if serializer.is_valid():
            return Response(serializer.validated_data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

class UserProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        serializer = UserSerializer(request.user)
        return Response(serializer.data)


class UserPublicKeyView(APIView):
    def get(self, request, user_id):
        try:
            user = User.objects.get(id=user_id)
            return Response({"public_key": user.public_key}, status=status.HTTP_200_OK)
        except User.DoesNotExist:
            return Response({"detail": "User not found"}, status=status.HTTP_404_NOT_FOUND)

class ForgotPasswordView(APIView):
    def post(self, request):
        email = request.data.get('email')
        if not email:
            return Response({"error": "Email is required"}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email=email).first()
        if not user:
            return Response({"error": "No user found with this email"}, status=status.HTTP_404_NOT_FOUND)

        # Generate a simple reset token (for demo; use a proper token system in production)
        reset_token = RefreshToken.for_user(user).access_token
        reset_link = f"http://127.0.0.1:8000/auth/reset-password/?token={reset_token}"

        # Send email (configure settings.py for email)
        send_mail(
            'Password Reset Request',
            f'Click the link to reset your password: {reset_link}',
            settings.DEFAULT_FROM_EMAIL,
            [email],
            fail_silently=False,
        )

        return Response({"message": "Password reset email sent"}, status=status.HTTP_200_OK)

class ResetPasswordView(APIView):
    def post(self, request):
        token = request.query_params.get('token')
        password = request.data.get('password')
        password2 = request.data.get('password2')

        if not token or not password or not password2:
            return Response({"error": "Token and passwords are required"}, status=status.HTTP_400_BAD_REQUEST)

        if password != password2:
            return Response({"error": "Passwords do not match"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # Validate token (simplified; use proper token validation in production)
            refresh = RefreshToken(token)
            user_id = refresh.payload.get('user_id')
            user = User.objects.get(id=user_id)
            user.set_password(password)
            user.save()
            return Response({"message": "Password reset successfully"}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": "Invalid or expired token"}, status=status.HTTP_400_BAD_REQUEST)