"""
Planting app models.

Contains domain-specific models for plant species and status tracking,
and per-user editor preferences.
"""
from django.conf import settings
from django.db import models


# =============================================================================
# PLANT STATUS (Lookup Table)
# =============================================================================
class PlantStatus(models.Model):
    """
    Plant status lookup table for tracking plant lifecycle and death causes.

    Data comes from: Admin panel or seed data.
    Used by: Plant and PlantVisit models to track individual plant states.
    """
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
    """
    Species reference data for plants and fungi.

    Data comes from: Admin panel or seed data.
    Used by: Plant, FungiVisit, SeedBatch, and other models.
    """
    # e.g. Tree, Shrub, Grass, Fungi
    category = models.CharField(max_length=50)
    cultivar = models.CharField(max_length=100)
    common_name = models.CharField(max_length=255, null=True, blank=True)
    scientific_name = models.CharField(max_length=255, null=True, blank=True)

    # Planting specifications (applies to all plants of this species)
    hole_size_mm = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True
    )
    hole_depth_mm = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True
    )
    spacing_mm = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True
    )

    class Meta:
        verbose_name_plural = "Species"

    def __str__(self):
        if self.common_name:
            return f"{self.common_name} ({self.cultivar})"
        return self.cultivar


# =============================================================================
# EDITOR PREFERENCES (Per-user settings for the project planner editor)
# =============================================================================
class EditorPreferences(models.Model):
    """
    Per-user preferences for the project planner editor.

    Auto-created on first access via get_or_create in views.
    Persists across devices (server-side, not localStorage).

    Data comes from: Editor settings UI or API.
    Used by: Project planner editor frontend (window.editorContext.preferences).
    """
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='editor_preferences',
    )

    # UI
    ui_scale = models.FloatField(
        default=1.0,
        help_text="Editor UI scale multiplier (0.8-1.2)",
    )

    # Drawing tools
    auto_topdown_drawing = models.BooleanField(
        default=True,
        help_text="Automatically set map to top-down view when using drawing tools",
    )

    class Meta:
        verbose_name = "Editor Preferences"
        verbose_name_plural = "Editor Preferences"

    def __str__(self):
        return f"Editor prefs for {self.user}"

    def to_dict(self):
        """Serialize preferences to a dict for JSON/template context."""
        return {
            'ui_scale': self.ui_scale,
            'auto_topdown_drawing': self.auto_topdown_drawing,
        }
