from django.contrib import admin
from .models import (
    SubscriptionTier, NavigationItem,
    Coordinate, Address, Contact, Status, PlantStatus, Species
)


# =============================================================================
# SUBSCRIPTION & NAVIGATION ADMIN
# =============================================================================

@admin.register(SubscriptionTier)
class SubscriptionTierAdmin(admin.ModelAdmin):
    list_display = ['name', 'slug', 'level', 'is_active']
    list_filter = ['is_active']
    search_fields = ['name', 'slug']
    ordering = ['level']
    prepopulated_fields = {'slug': ('name',)}


@admin.register(NavigationItem)
class NavigationItemAdmin(admin.ModelAdmin):
    list_display = ['label', 'item_id', 'item_type', 'parent', 'is_active', 'staff_only', 'display_order']
    list_filter = ['item_type', 'is_active', 'staff_only', 'allowed_tiers']
    search_fields = ['label', 'item_id']
    ordering = ['display_order', 'label']
    filter_horizontal = ['allowed_tiers']

    fieldsets = (
        (None, {
            'fields': ('item_id', 'label', 'item_type', 'icon', 'url_name')
        }),
        ('Hierarchy', {
            'fields': ('parent', 'display_order')
        }),
        ('Access Control', {
            'fields': ('is_active', 'staff_only', 'allowed_tiers'),
            'description': 'Staff/superusers always have access regardless of tier settings. Staff-only items are completely hidden from regular users.'
        }),
    )


# =============================================================================
# CORE REFERENCE DATA ADMIN
# =============================================================================

@admin.register(Coordinate)
class CoordinateAdmin(admin.ModelAdmin):
    list_display = ['latitude', 'longitude', 'altitude', 'coordinate_system']
    search_fields = ['what3w']


@admin.register(Address)
class AddressAdmin(admin.ModelAdmin):
    list_display = ['address_line_1', 'city', 'postcode', 'country_code']
    list_filter = ['country_code', 'city']
    search_fields = ['address_line_1', 'city', 'postcode']


@admin.register(Contact)
class ContactAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'company_name', 'primary_contact_name', 'land_owner_name']
    search_fields = ['company_name', 'primary_contact_name', 'land_owner_name']


@admin.register(Status)
class StatusAdmin(admin.ModelAdmin):
    list_display = ['emoji', 'name', 'code', 'is_archived', 'display_order']
    list_filter = ['is_archived', 'includes_in_carbon']
    ordering = ['display_order']


@admin.register(PlantStatus)
class PlantStatusAdmin(admin.ModelAdmin):
    list_display = ['emoji', 'name', 'code', 'category', 'is_dead', 'display_order']
    list_filter = ['is_dead', 'category']
    ordering = ['display_order']


@admin.register(Species)
class SpeciesAdmin(admin.ModelAdmin):
    list_display = ['cultivar', 'common_name', 'scientific_name', 'category']
    list_filter = ['category']
    search_fields = ['cultivar', 'common_name', 'scientific_name']
