from django.urls import path
from authentication.views import (
    RegisterView, LoginView, UserProfileView, ForgotPasswordView,
    ResetPasswordView, UserPublicKeyView
)
from rest_framework_simplejwt.views import TokenRefreshView  # Add this

urlpatterns = [
    path('register/', RegisterView.as_view(), name='register'),
    path('login/', LoginView.as_view(), name='login'),
    path('user/<int:user_id>/public_key/', UserPublicKeyView.as_view(), name='user_public_key'),
    path('profile/', UserProfileView.as_view(), name='profile'),
    path('forgot-password/', ForgotPasswordView.as_view(), name='forgot_password'),
    path('reset-password/', ResetPasswordView.as_view(), name='reset_password'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),  # Add refresh endpoint
]