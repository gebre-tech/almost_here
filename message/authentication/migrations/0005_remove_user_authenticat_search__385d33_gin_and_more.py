# Generated by Django 5.1.7 on 2025-04-27 19:06

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('authentication', '0004_user_search_vector_and_more'),
    ]

    operations = [
        migrations.RemoveIndex(
            model_name='user',
            name='authenticat_search__385d33_gin',
        ),
        migrations.RemoveField(
            model_name='user',
            name='search_vector',
        ),
    ]
