"""
Admin configuration for the users app.

Registers User and SubscriptionTier models with the Django admin.
"""
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, SubscriptionTier
from planting.models import EditorPreferences


@admin.register(SubscriptionTier)
class SubscriptionTierAdmin(admin.ModelAdmin):
    """Admin configuration for SubscriptionTier model."""

    list_display = ['name', 'slug', 'level', 'is_active']
    list_filter = ['is_active']
    search_fields = ['name', 'slug']
    ordering = ['level']
    prepopulated_fields = {'slug': ('name',)}


class EditorPreferencesInline(admin.StackedInline):
    """Inline editor preferences on the User admin page."""
    model = EditorPreferences
    can_delete = False
    verbose_name_plural = 'Editor Preferences'


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Custom User admin that includes subscription tier and profile fields."""

    inlines = [EditorPreferencesInline]

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
