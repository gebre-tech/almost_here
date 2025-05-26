# Profile/model.py
from django.db import models
from authentication.models import User

class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    bio = models.TextField(blank=True, null=True)
    profile_picture = models.ImageField(upload_to="profile_pics/", blank=True, null=True)
    last_seen = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.user.email
