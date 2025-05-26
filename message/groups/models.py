from django.db import models
from authentication.models import User
from django.db.models import Manager

class Group(models.Model):
    name = models.CharField(max_length=255)
    creator = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="created_groups"
    )
    admins = models.ManyToManyField(
        User, related_name="admin_groups"
    )
    members = models.ManyToManyField(User, related_name="group_memberships")
    can_members_send_messages = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    profile_picture = models.ImageField(upload_to="group_profiles/", blank=True, null=True)

    def __str__(self):
        return self.name

    def _is_creator_in_admins(self):
        # Helper method to check if creator is in admins, safe for sync/async
        return self.admins.filter(id=self.creator.id).exists()

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.creator and not self._is_creator_in_admins():
            self.admins.add(self.creator)

class GroupMessage(models.Model):
    group = models.ForeignKey(Group, on_delete=models.CASCADE, related_name="messages")
    sender = models.ForeignKey(User, on_delete=models.CASCADE, null=True, blank=True)
    message = models.TextField(blank=True, null=True)
    attachment = models.FileField(upload_to="group_attachments/", blank=True, null=True)
    file_name = models.CharField(max_length=255, blank=True, null=True)
    file_type = models.CharField(max_length=100, blank=True, null=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    reactions = models.JSONField(default=dict)
    read_by = models.ManyToManyField(User, related_name="read_group_messages")
    parent_message = models.ForeignKey(
        'self', on_delete=models.SET_NULL, null=True, blank=True, related_name="replies"
    )  # For replies
    is_pinned = models.BooleanField(default=False)  # For pinned messages

    def __str__(self):
        sender_name = "System Helper" if self.sender is None else self.sender.username
        return f"{sender_name} in {self.group.name}: {self.message[:30]}"