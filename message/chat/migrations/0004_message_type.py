# Generated by Django 5.1.7 on 2025-05-15 17:16

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('chat', '0003_message_message_id'),
    ]

    operations = [
        migrations.AddField(
            model_name='message',
            name='type',
            field=models.CharField(choices=[('text', 'Text'), ('photo', 'Photo'), ('video', 'Video'), ('audio', 'Audio'), ('file', 'File')], default='text', max_length=20),
        ),
    ]
