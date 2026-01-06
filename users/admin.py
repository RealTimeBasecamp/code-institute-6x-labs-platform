from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Custom User admin that includes subscription tier and profile fields."""

    # Fields to display in the list view
    list_display = [
        'username', 'email', 'display_name', 'subscription_tier',
        'is_staff', 'is_superuser', 'is_active'
    ]
    list_filter = ['is_staff', 'is_superuser', 'is_active', 'subscription_tier']
    search_fields = ['username', 'email', 'display_name', 'first_name', 'last_name']

    # Extend the default UserAdmin fieldsets
    fieldsets = BaseUserAdmin.fieldsets + (
        ('Profile', {
            'fields': ('phone', 'pronouns', 'title', 'department', 'display_name', 'avatar')
        }),
        ('Subscription', {
            'fields': ('subscription_tier',),
            'description': 'Staff/superusers bypass subscription tier checks automatically.'
        }),
        ('Preferences', {
            'fields': ('theme', 'sidebar_width'),
            'classes': ('collapse',)
        }),
    )

    # Fields for adding a new user
    add_fieldsets = BaseUserAdmin.add_fieldsets + (
        ('Profile', {
            'fields': ('email', 'display_name', 'subscription_tier')
        }),
    )
