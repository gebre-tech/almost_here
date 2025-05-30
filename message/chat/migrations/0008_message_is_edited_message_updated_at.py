# Generated by Django 5.1.7 on 2025-05-25 15:51

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0007_remove_message_is_deleted_remove_message_updated_at'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='is_edited',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='message',
            name='updated_at',
            field=models.DateTimeField(auto_now=True),
        ),
    ]
