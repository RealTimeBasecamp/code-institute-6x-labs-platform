from django.db import models
from django_countries.fields import CountryField
from django.core.exceptions import ValidationError
from django.conf import settings


# =============================================================================
# SUBSCRIPTION TIER (Controls feature access for paying customers)
# =============================================================================
class SubscriptionTier(models.Model):
    """
    Subscription tier that controls feature access.
    Staff/superusers bypass tier checks via Django's is_staff/is_superuser flags.
    """
    slug = models.SlugField(unique=True, max_length=50)
    name = models.CharField(max_length=100)
    level = models.PositiveIntegerField(default=0, help_text="Lower number = more access")
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['level']

    def __str__(self):
        return self.name


# =============================================================================
# NAVIGATION ITEM (Self-referential for nested menus)
# =============================================================================
class NavigationItem(models.Model):
    """Navigation menu item with tier-based access control."""

    TYPE_CHOICES = [
        ('profile', 'Profile'),
        ('modal', 'Modal Trigger'),
        ('link', 'Link'),
        ('parent', 'Parent (has children)'),
    ]

    # Core fields
    item_id = models.SlugField(unique=True, max_length=100)
    item_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='link')
    label = models.CharField(max_length=100)
    icon = models.CharField(max_length=100, help_text="Bootstrap icon class or image path")
    url_name = models.CharField(
        max_length=255,
        blank=True,
        help_text="Django URL name (e.g., 'projects:project_planner') or path"
    )
    is_active = models.BooleanField(default=True, help_text="False = 'Coming Soon'")

    # Hierarchy
    parent = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='children'
    )
    display_order = models.PositiveIntegerField(default=0)

    # Access control
    allowed_tiers = models.ManyToManyField(
        SubscriptionTier,
        related_name='accessible_nav_items',
        blank=True,
        help_text="Tiers that can access this item. Staff/superusers always have access."
    )
    staff_only = models.BooleanField(
        default=False,
        help_text="If True, only staff/superusers can see this item. Regular users won't see it at all."
    )

    class Meta:
        ordering = ['display_order', 'label']

    def __str__(self):
        return f"{self.label} ({self.item_id})"

    def is_allowed_for_user(self, user):
        """Check if this item is accessible for a given user."""
        if not user.is_authenticated:
            return False
        # Staff and superusers bypass tier checks
        if user.is_staff or user.is_superuser:
            return True
        # Check user's subscription tier
        if hasattr(user, 'subscription_tier') and user.subscription_tier:
            return self.allowed_tiers.filter(pk=user.subscription_tier.pk).exists()
        return False


# =============================================================================
# COORDINATE
# =============================================================================
class Coordinate(models.Model):
    latitude = models.DecimalField(max_digits=10, decimal_places=7, db_index=True)
    longitude = models.DecimalField(max_digits=11, decimal_places=7, db_index=True)
    altitude = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    elevation = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    coordinate_system = models.CharField(max_length=20, default="WGS84")
    what3w = models.CharField(max_length=50, null=True, blank=True, db_index=True)

    def __str__(self):
        return f"{self.latitude}, {self.longitude}"


# =============================================================================
# ADDRESS
# =============================================================================
class Address(models.Model):
    address_line_1 = models.CharField(max_length=255)
    address_line_2 = models.CharField(max_length=255, null=True, blank=True)
    city = models.CharField(max_length=100, db_index=True)
    region = models.CharField(max_length=100, null=True, blank=True)
    postcode = models.CharField(max_length=20, null=True, blank=True, db_index=True)
    country_code = CountryField(null=True, blank=True, db_index=True)

    class Meta:
        verbose_name_plural = "Addresses"

    def __str__(self):
        return f"{self.address_line_1}, {self.city}"


# =============================================================================
# CONTACT
# =============================================================================
class Contact(models.Model):
    # Company details
    company_name = models.CharField(max_length=255, null=True, blank=True)
    company_email = models.EmailField(max_length=255, null=True, blank=True)
    company_phone = models.CharField(max_length=30, null=True, blank=True)
    company_website = models.URLField(max_length=255, null=True, blank=True)

    # Primary contact
    primary_contact_title = models.CharField(max_length=100, null=True, blank=True)
    primary_contact_name = models.CharField(max_length=255, null=True, blank=True)
    primary_contact_pronouns = models.CharField(max_length=20, null=True, blank=True)
    primary_contact_email = models.EmailField(max_length=255, null=True, blank=True)
    primary_contact_phone = models.CharField(max_length=30, null=True, blank=True)

    # Secondary contact (optional)
    secondary_contact_title = models.CharField(max_length=100, null=True, blank=True)
    secondary_contact_name = models.CharField(max_length=255, null=True, blank=True)
    secondary_contact_pronouns = models.CharField(max_length=20, null=True, blank=True)
    secondary_contact_email = models.EmailField(max_length=255, null=True, blank=True)
    secondary_contact_phone = models.CharField(max_length=30, null=True, blank=True)

    # Land owner (may differ from primary contact)
    land_owner_title = models.CharField(max_length=100, null=True, blank=True)
    land_owner_name = models.CharField(max_length=255, null=True, blank=True)
    land_owner_pronouns = models.CharField(max_length=20, null=True, blank=True)
    land_owner_email = models.EmailField(max_length=255, null=True, blank=True)
    land_owner_phone = models.CharField(max_length=30, null=True, blank=True)
    land_owner_organization = models.CharField(max_length=255, null=True, blank=True)
    land_owner_preferred_contact_method = models.CharField(max_length=20, null=True, blank=True)

    # Notes
    notes = models.TextField(null=True, blank=True)

    def clean(self):
        """Validate that at least one contact method is provided"""
        has_company_info = any([
            self.company_name, self.company_email, self.company_phone
        ])
        has_primary_contact = any([
            self.primary_contact_name, self.primary_contact_email, self.primary_contact_phone
        ])
        has_landowner = any([
            self.land_owner_name, self.land_owner_email, self.land_owner_phone
        ])

        if not (has_company_info or has_primary_contact or has_landowner):
            raise ValidationError(
                'At least one contact method must be provided (company, primary contact, or land owner).'
            )

    def __str__(self):
        if self.company_name:
            return self.company_name
        if self.primary_contact_name:
            return f"Contact: {self.primary_contact_name}"
        if self.land_owner_name:
            return f"Landowner: {self.land_owner_name}"
        return f"Contact #{self.pk}"


# =============================================================================
# STATUS (Lookup Table - shared by Site and Project)
# =============================================================================
class Status(models.Model):
    # Active statuses
    STATUS_PROSPECTING = 'prospecting'
    STATUS_PENDING = 'pending_approval'
    STATUS_DELAYED = 'delayed'
    STATUS_STOPPED = 'stopped'
    STATUS_IN_PROGRESS = 'in_progress'
    STATUS_COMPLETED = 'completed'

    # Archived statuses
    STATUS_ARCHIVED_INCLUDED = 'archived_included'
    STATUS_ARCHIVED_EXCLUDED = 'archived_excluded'

    STATUS_CHOICES = [
        (STATUS_PROSPECTING, 'Prospecting'),
        (STATUS_PENDING, 'Pending Approval'),
        (STATUS_DELAYED, 'Delayed/Issue'),
        (STATUS_STOPPED, 'Stopped'),
        (STATUS_IN_PROGRESS, 'In Progress'),
        (STATUS_COMPLETED, 'Completed'),
        (STATUS_ARCHIVED_INCLUDED, 'Archived (Stats Included)'),
        (STATUS_ARCHIVED_EXCLUDED, 'Archived (Stats Excluded)'),
    ]

    code = models.CharField(max_length=30, unique=True, choices=STATUS_CHOICES)
    name = models.CharField(max_length=100)
    emoji = models.CharField(max_length=10)
    is_archived = models.BooleanField(default=False)
    includes_in_carbon = models.BooleanField(default=True)
    display_order = models.IntegerField(default=0)

    class Meta:
        verbose_name_plural = "Statuses"

    def __str__(self):
        return f"{self.emoji} {self.name}"


# =============================================================================
# PLANT STATUS (Lookup Table)
# =============================================================================
class PlantStatus(models.Model):
    # Status Categories
    # Queue states
    STATE_QUEUED = 'queued'

    # Tree states
    STATE_NEWLY_PLANTED = 'newly_planted'
    STATE_TEENAGE = 'teenage'
    STATE_MATURE = 'mature'
    STATE_LANDMARK = 'landmark'
    STATE_EXISTING_DEAD = 'existing_dead'

    # Tree deaths - Environmental / Weather
    DEATH_DROUGHT = 'death_drought'
    DEATH_STORM = 'death_storm'
    DEATH_FLOODING = 'death_flooding'
    DEATH_FROST = 'death_frost'
    DEATH_SNOW = 'death_snow'
    DEATH_TORNADO = 'death_tornado'
    DEATH_WINDTHROW = 'death_windthrow'

    # Soil & Growth Issues
    DEATH_POOR_SOIL = 'death_poor_soil'
    DEATH_FAILED_GERMINATE = 'death_failed_germinate'
    DEATH_ROOTS_UNABLE = 'death_roots_unable'
    DEATH_COMPETITION = 'death_competition'

    # Animals & Pests
    DEATH_EATEN_FAUNA = 'death_eaten_fauna'
    DEATH_INSECT_INFEST = 'death_insect_infest'
    DEATH_FUNGAL_DISEASE = 'death_fungal_disease'
    DEATH_LARGE_ANIMAL = 'death_large_animal'

    # Human-related
    DEATH_DEFORESTATION = 'death_deforestation'
    DEATH_WILDFIRE = 'death_wildfire'
    DEATH_LAND_CLEARING = 'death_land_clearing'
    DEATH_VANDALISM = 'death_vandalism'
    DEATH_POLLUTION = 'death_pollution'

    # Unknown
    DEATH_UNKNOWN = 'death_unknown'

    CODE_CHOICES = [
        # Queue states
        (STATE_QUEUED, STATE_QUEUED),
        # Tree states
        (STATE_NEWLY_PLANTED, STATE_NEWLY_PLANTED),
        (STATE_TEENAGE, STATE_TEENAGE),
        (STATE_MATURE, STATE_MATURE),
        (STATE_LANDMARK, STATE_LANDMARK),
        (STATE_EXISTING_DEAD, STATE_EXISTING_DEAD),
        # Environmental / Weather
        (DEATH_DROUGHT, DEATH_DROUGHT),
        (DEATH_STORM, DEATH_STORM),
        (DEATH_FLOODING, DEATH_FLOODING),
        (DEATH_FROST, DEATH_FROST),
        (DEATH_SNOW, DEATH_SNOW),
        (DEATH_TORNADO, DEATH_TORNADO),
        (DEATH_WINDTHROW, DEATH_WINDTHROW),
        # Soil & Growth Issues
        (DEATH_POOR_SOIL, DEATH_POOR_SOIL),
        (DEATH_FAILED_GERMINATE, DEATH_FAILED_GERMINATE),
        (DEATH_ROOTS_UNABLE, DEATH_ROOTS_UNABLE),
        (DEATH_COMPETITION, DEATH_COMPETITION),
        # Animals & Pests
        (DEATH_EATEN_FAUNA, DEATH_EATEN_FAUNA),
        (DEATH_INSECT_INFEST, DEATH_INSECT_INFEST),
        (DEATH_FUNGAL_DISEASE, DEATH_FUNGAL_DISEASE),
        (DEATH_LARGE_ANIMAL, DEATH_LARGE_ANIMAL),
        # Human-related
        (DEATH_DEFORESTATION, DEATH_DEFORESTATION),
        (DEATH_WILDFIRE, DEATH_WILDFIRE),
        (DEATH_LAND_CLEARING, DEATH_LAND_CLEARING),
        (DEATH_VANDALISM, DEATH_VANDALISM),
        (DEATH_POLLUTION, DEATH_POLLUTION),
        # Unknown
        (DEATH_UNKNOWN, DEATH_UNKNOWN),
    ]

    CATEGORY_CHOICES = [
        # Queue states
        (STATE_QUEUED, 'Queued for planting'),
        # Tree states
        (STATE_NEWLY_PLANTED, 'Newly planted tree'),
        (STATE_TEENAGE, 'Teenage tree'),
        (STATE_MATURE, 'Mature tree'),
        (STATE_LANDMARK, 'Landmark/historical tree'),
        (STATE_EXISTING_DEAD, 'Existing dead tree'),
        # Environmental / Weather
        (DEATH_DROUGHT, 'Killed by drought'),
        (DEATH_STORM, 'Killed by storm'),
        (DEATH_FLOODING, 'Killed by flooding'),
        (DEATH_FROST, 'Killed by frost'),
        (DEATH_SNOW, 'Killed by snow'),
        (DEATH_TORNADO, 'Tornado / hurricane damage'),
        (DEATH_WINDTHROW, 'Windthrow / high wind stress'),
        # Soil & Growth Issues
        (DEATH_POOR_SOIL, 'Killed by poor soil conditions'),
        (DEATH_FAILED_GERMINATE, 'Failed to germinate'),
        (DEATH_ROOTS_UNABLE, 'Roots unable to establish'),
        (DEATH_COMPETITION, 'Over competition from weeds/invasive plants'),
        # Animals & Pests
        (DEATH_EATEN_FAUNA, 'Eaten by fauna (herbivores)'),
        (DEATH_INSECT_INFEST, 'Insect infestation'),
        (DEATH_FUNGAL_DISEASE, 'Fungal or bacterial disease'),
        (DEATH_LARGE_ANIMAL, 'Large animal damage'),
        # Human-related
        (DEATH_DEFORESTATION, 'Deforestation / logging'),
        (DEATH_WILDFIRE, 'Wildfire'),
        (DEATH_LAND_CLEARING, 'Land clearing / agriculture expansion'),
        (DEATH_VANDALISM, 'Vandalism / trampling'),
        (DEATH_POLLUTION, 'Pollution / acid rain'),
        # Unknown
        (DEATH_UNKNOWN, 'Unknown cause of death'),
    ]

    code = models.CharField(max_length=30, unique=True, choices=CODE_CHOICES)
    name = models.CharField(max_length=100)
    emoji = models.CharField(max_length=10)
    category = models.CharField(max_length=30, choices=CATEGORY_CHOICES)
    description = models.TextField(null=True, blank=True)
    is_dead = models.BooleanField(default=False)
    display_order = models.IntegerField(default=0)

    class Meta:
        verbose_name_plural = "Plant Statuses"

    def __str__(self):
        return f"{self.emoji} {self.name}"


# =============================================================================
# SPECIES (Reusable reference data for plant types)
# =============================================================================
class Species(models.Model):
    category = models.CharField(max_length=50)  # e.g. Tree, Shrub, Grass, Fungi
    cultivar = models.CharField(max_length=100)
    common_name = models.CharField(max_length=255, null=True, blank=True)
    scientific_name = models.CharField(max_length=255, null=True, blank=True)

    # Planting specifications (applies to all plants of this species)
    hole_size_mm = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    hole_depth_mm = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    spacing_mm = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    class Meta:
        verbose_name_plural = "Species"

    def __str__(self):
        if self.common_name:
            return f"{self.common_name} ({self.cultivar})"
        return self.cultivar
