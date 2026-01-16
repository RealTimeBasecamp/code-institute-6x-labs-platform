from datetime import date
from decimal import Decimal

from django.db import models
from django.db.models import Avg, Sum, Count, Q
from django.utils.text import slugify

from core.models import Address, Contact, Coordinate
from planting.models import PlantStatus, Species
from users.models import User
from seed_catalogue.models import SeedBatch, FungiBatch
from drones.models import Drone


# =============================================================================
# STATUS (Lookup Table - shared by Site and Project)
# =============================================================================
class Status(models.Model):
    """
    Status lookup table for Projects and Sites.

    Data comes from: Admin panel or seed data.
    Used by: Project and Site models to track workflow state.
    """
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
# PROJECT
# =============================================================================
class Project(models.Model):
    # Project type choices
    PROJECT_TYPE_PRIVATE_LAND = 'private_land'
    PROJECT_TYPE_PUBLIC_LAND = 'public_land'
    PROJECT_TYPE_REFORESTATION = 'reforestation'
    PROJECT_TYPE_URBAN_GREENING = 'urban_greening'
    PROJECT_TYPE_AGROFORESTRY = 'agroforestry'

    PROJECT_TYPE_CHOICES = [
        (PROJECT_TYPE_PRIVATE_LAND, 'Private Land'),
        (PROJECT_TYPE_PUBLIC_LAND, 'Public Land'),
        (PROJECT_TYPE_REFORESTATION, 'Reforestation Project'),
        (PROJECT_TYPE_URBAN_GREENING, 'Urban Greening'),
        (PROJECT_TYPE_AGROFORESTRY, 'Agroforestry'),
    ]

    # Soil type choices
    SOIL_TYPE_CLAY = 'clay'
    SOIL_TYPE_SANDY = 'sandy'
    SOIL_TYPE_SILTY = 'silty'
    SOIL_TYPE_PEATY = 'peaty'
    SOIL_TYPE_CHALKY = 'chalky'
    SOIL_TYPE_LOAMY = 'loamy'
    SOIL_TYPE_MIXED = 'mixed'

    SOIL_TYPE_CHOICES = [
        (SOIL_TYPE_CLAY, 'Clay'),
        (SOIL_TYPE_SANDY, 'Sandy'),
        (SOIL_TYPE_SILTY, 'Silty'),
        (SOIL_TYPE_PEATY, 'Peaty'),
        (SOIL_TYPE_CHALKY, 'Chalky'),
        (SOIL_TYPE_LOAMY, 'Loamy'),
        (SOIL_TYPE_MIXED, 'Mixed'),
    ]

    SOIL_TYPE_DESCRIPTIONS = {
        SOIL_TYPE_CLAY: 'Dense, water-retaining soil. Good for some trees.',
        SOIL_TYPE_SANDY: 'Light, fast-draining soil. Needs more watering.',
        SOIL_TYPE_SILTY: 'Fertile, moisture-retaining soil.',
        SOIL_TYPE_PEATY: 'Acidic, high organic matter. Good for specific species.',
        SOIL_TYPE_CHALKY: 'Alkaline, well-draining. Limited plant selection.',
        SOIL_TYPE_LOAMY: 'Ideal balanced soil for most plants.',
        SOIL_TYPE_MIXED: 'Combination of soil types across the site.',
    }

    # Climate choices
    CLIMATE_TROPICAL = 'tropical'
    CLIMATE_DRY = 'dry'
    CLIMATE_TEMPERATE = 'temperate'
    CLIMATE_CONTINENTAL = 'continental'
    CLIMATE_POLAR = 'polar'
    CLIMATE_MEDITERRANEAN = 'mediterranean'

    CLIMATE_CHOICES = [
        (CLIMATE_TROPICAL, 'Tropical'),
        (CLIMATE_DRY, 'Dry/Arid'),
        (CLIMATE_TEMPERATE, 'Temperate'),
        (CLIMATE_CONTINENTAL, 'Continental'),
        (CLIMATE_POLAR, 'Polar'),
        (CLIMATE_MEDITERRANEAN, 'Mediterranean'),
    ]

    CLIMATE_DESCRIPTIONS = {
        CLIMATE_TROPICAL: 'Hot and humid year-round with high rainfall.',
        CLIMATE_DRY: 'Low rainfall, high evaporation. Drought-resistant species needed.',
        CLIMATE_TEMPERATE: 'Mild temperatures with distinct seasons.',
        CLIMATE_CONTINENTAL: 'Hot summers, cold winters. Wide temperature range.',
        CLIMATE_POLAR: 'Very cold with short growing seasons.',
        CLIMATE_MEDITERRANEAN: 'Warm, dry summers and mild, wet winters.',
    }

    COORDINATE_HELP = (
        "GPS coordinates help us accurately map your project site. "
        "You can find coordinates using Google Maps or GPS devices. "
        "These are optional but recommended for larger projects."
    )

    status = models.ForeignKey(
        Status,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='projects'
    )
    name = models.CharField(max_length=255, db_index=True)
    slug = models.SlugField(max_length=255, unique=True, db_index=True)
    description = models.TextField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    address = models.ForeignKey(Address, on_delete=models.PROTECT)
    contact = models.ForeignKey(Contact, on_delete=models.PROTECT)
    coordinates = models.ForeignKey(
        Coordinate,
        on_delete=models.PROTECT,
        null=True,
        blank=True
    )

    # e.g. Private Land, Public Land, Reforestation Project
    project_type = models.CharField(max_length=100, choices=PROJECT_TYPE_CHOICES)

    # e.g. Clay, Sandy, Silty, Peaty, Chalky, Loamy
    soil_type = models.CharField(max_length=50, choices=SOIL_TYPE_CHOICES)

    # e.g. Tropical, Dry, Temperate, Continental, Polar
    climate = models.CharField(max_length=50, choices=CLIMATE_CHOICES)
    area_hectares = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True
    )  # Calculated/updated later from site data

    # Aggregated carbon metrics (summed from all sites in this project)
    total_co2_sequestered_kg = models.BigIntegerField(null=True, blank=True)
    soil_co2_sequestered_kg = models.BigIntegerField(null=True, blank=True)
    plant_co2_sequestered_kg = models.BigIntegerField(null=True, blank=True)
    total_plants = models.IntegerField(null=True, blank=True)

    # Midpoint coordinate (calculated from all site polygon coordinates)
    midpoint_latitude = models.DecimalField(
        max_digits=10,
        decimal_places=7,
        null=True,
        blank=True
    )
    midpoint_longitude = models.DecimalField(
        max_digits=11,
        decimal_places=7,
        null=True,
        blank=True
    )

    # Bounding box (calculated from all site bounding boxes - for map centering)
    bounding_box_min_latitude = models.DecimalField(
        max_digits=10,
        decimal_places=7,
        null=True,
        blank=True
    )
    bounding_box_max_latitude = models.DecimalField(
        max_digits=10,
        decimal_places=7,
        null=True,
        blank=True
    )
    bounding_box_min_longitude = models.DecimalField(
        max_digits=11,
        decimal_places=7,
        null=True,
        blank=True
    )
    bounding_box_max_longitude = models.DecimalField(
        max_digits=11,
        decimal_places=7,
        null=True,
        blank=True
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    created_by = models.ForeignKey(User, on_delete=models.PROTECT, null=True, blank=True, related_name='created_projects')

    def calculate_midpoint_from_sites(self):
        """
        Calculate and update the midpoint coordinate based on all site polygon coordinates.
        Uses the center of each site's bounding box or polygon (whichever is available).
        Returns the calculated (latitude, longitude) tuple or (None, None) if no sites have coordinates.
        """
        all_latitudes = []
        all_longitudes = []

        for site in self.sites.all():
            geojson = site.site_boundary_polygon if site.site_boundary_polygon else site.bounding_box_coordinates

            if geojson and isinstance(geojson, dict) and 'coordinates' in geojson:
                coordinates = geojson['coordinates'][0]
                for coord in coordinates:
                    if isinstance(coord, (list, tuple)) and len(coord) >= 2:
                        all_longitudes.append(Decimal(str(coord[0])))
                        all_latitudes.append(Decimal(str(coord[1])))

        if all_latitudes and all_longitudes:
            self.midpoint_latitude = sum(all_latitudes) / len(all_latitudes)
            self.midpoint_longitude = sum(all_longitudes) / len(all_longitudes)
            self.save(update_fields=['midpoint_latitude', 'midpoint_longitude'])
            return (self.midpoint_latitude, self.midpoint_longitude)

        return (None, None)

    def calculate_bounding_box_from_sites(self):
        """
        Calculate and update the project bounding box from all site bounding boxes.
        Uses max extents of all sites for map centering.
        """
        all_lats = []
        all_lngs = []

        for site in self.sites.all():
            geojson = site.bounding_box_coordinates if site.bounding_box_coordinates else site.site_boundary_polygon

            if geojson and isinstance(geojson, dict) and 'coordinates' in geojson:
                coordinates = geojson['coordinates'][0]
                for coord in coordinates:
                    if isinstance(coord, (list, tuple)) and len(coord) >= 2:
                        all_lngs.append(Decimal(str(coord[0])))
                        all_lats.append(Decimal(str(coord[1])))

        if all_lats and all_lngs:
            self.bounding_box_min_latitude = min(all_lats)
            self.bounding_box_max_latitude = max(all_lats)
            self.bounding_box_min_longitude = min(all_lngs)
            self.bounding_box_max_longitude = max(all_lngs)
            self.save(update_fields=[
                'bounding_box_min_latitude', 'bounding_box_max_latitude',
                'bounding_box_min_longitude', 'bounding_box_max_longitude'
            ])
            return (
                self.bounding_box_min_latitude, self.bounding_box_max_latitude,
                self.bounding_box_min_longitude, self.bounding_box_max_longitude
            )

        return (None, None, None, None)

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)

        # On save, recalculate midpoint and bounding box
        super().save(*args, **kwargs)
        self.calculate_midpoint_from_sites()
        self.calculate_bounding_box_from_sites()

    def __str__(self):
        return self.name

    def get_card_groups(self):
        """
        Returns card group data for project planner display.
        Each group is rendered as a card with title, icon, and fields.
        
        Returns:
            List of dicts with keys: title, icon, fields (or sections for Contact)
        """
        return [
            {
                'title': 'Site Details',
                'icon': 'bi bi-info-circle',
                'fields': [
                    ('Project Name', self.name),
                    ('Project Type', self.project_type or 'N/A'),
                    ('Soil Type', self.soil_type or 'N/A'),
                    ('Climate', self.climate or 'N/A'),
                    ('Area (hectares)', f"{self.area_hectares}" if self.area_hectares else 'N/A'),
                ]
            },
            {
                'title': 'Address Information',
                'icon': 'bi bi-geo-alt',
                'fields': [
                    ('Address Line 1', self.address.address_line_1 or 'N/A'),
                    ('Address Line 2', self.address.address_line_2 or 'N/A'),
                    ('City', self.address.city or 'N/A'),
                    ('Region', self.address.region or 'N/A'),
                    ('Postcode', self.address.postcode or 'N/A'),
                    ('Country', self.address.country_code or 'N/A'),
                ]
            },
            {
                'title': 'Coordinate Information',
                'icon': 'bi bi-map',
                'fields': [
                    ('Latitude', self.coordinates.latitude if self.coordinates else 'N/A'),
                    ('Longitude', self.coordinates.longitude if self.coordinates else 'N/A'),
                    ('Altitude (m)', self.coordinates.altitude if self.coordinates else 'N/A'),
                    ('Elevation (m)', self.coordinates.elevation if self.coordinates else 'N/A'),
                    ('Coordinate System', self.coordinates.coordinate_system if self.coordinates else 'N/A'),
                    ('What3Words', self.coordinates.what3w if self.coordinates else 'N/A'),
                ]
            },
            {
                'title': 'Carbon Metrics',
                'icon': 'bi bi-graph-up',
                'fields': [
                    ('Total CO2 Sequestered (kg)', f"{self.total_co2_sequestered_kg:,}" if self.total_co2_sequestered_kg else 'N/A'),
                    ('Soil CO2 Sequestered (kg)', f"{self.soil_co2_sequestered_kg:,}" if self.soil_co2_sequestered_kg else 'N/A'),
                    ('Plant CO2 Sequestered (kg)', f"{self.plant_co2_sequestered_kg:,}" if self.plant_co2_sequestered_kg else 'N/A'),
                    ('Total Plants', f"{self.total_plants:,}" if self.total_plants else 'N/A'),
                ]
            },
            {
                'title': 'Contact Information',
                'icon': 'bi bi-people',
                'sections': [
                    {
                        'title': 'Company Contact',
                        'fields': [
                            ('Company Name', self.contact.company_name or 'N/A'),
                            ('Company Email', self.contact.company_email or 'N/A'),
                            ('Company Phone', self.contact.company_phone or 'N/A'),
                        ]
                    },
                    {
                        'title': 'Primary Contact',
                        'fields': [
                            ('Contact Name', self.contact.primary_contact_name or 'N/A'),
                            ('Contact Email', self.contact.primary_contact_email or 'N/A'),
                            ('Contact Phone', self.contact.primary_contact_phone or 'N/A'),
                        ]
                    },
                    {
                        'title': 'Land Owner Contact',
                        'fields': [
                            ('Land Owner Name', self.contact.land_owner_name or 'N/A'),
                            ('Land Owner Email', self.contact.land_owner_email or 'N/A'),
                            ('Land Owner Phone', self.contact.land_owner_phone or 'N/A'),
                        ]
                    },
                    {
                        'title': 'Secondary Contact',
                        'fields': [
                            ('Contact Name', self.contact.secondary_contact_name or 'N/A'),
                            ('Contact Email', self.contact.secondary_contact_email or 'N/A'),
                            ('Contact Phone', self.contact.secondary_contact_phone or 'N/A'),
                        ]
                    },
                ]
            },
        ]


# =============================================================================
# SITE
# =============================================================================
class Site(models.Model):
    project = models.ForeignKey(Project, on_delete=models.PROTECT, related_name='sites')
    status = models.ForeignKey(
        Status,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='sites'
    )
    name = models.CharField(max_length=255, db_index=True)
    description = models.TextField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    est_completion_date = models.DateTimeField()
    completion_percentage = models.IntegerField()
    maturity_years = models.IntegerField()
    current_year = models.IntegerField()
    total_plants = models.IntegerField()
    total_available_land_hectares = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True
    )
    land_utilised_percentage = models.IntegerField(null=True, blank=True)
    avg_health_index = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    total_co2_sequestered_kg = models.BigIntegerField(null=True, blank=True)
    soil_co2_sequestered_kg = models.BigIntegerField(null=True, blank=True)
    plant_co2_sequestered_kg = models.BigIntegerField(null=True, blank=True)
    average_plant_height_m = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True
    )

    # Biodiversity tracking
    biodiversity_index = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True
    )
    biodiversity_last_calculated = models.DateTimeField(null=True, blank=True)

    # Coordinate-based geometry (GeoJSON format for MapLibre compatibility)
    bounding_box_coordinates = models.JSONField(default=dict, blank=True)
    site_boundary_polygon = models.JSONField(default=dict, blank=True)
    site_exclusion_polygons = models.JSONField(default=dict, blank=True)
    entrance_pathfinding = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name}"


# =============================================================================
# PLANTING ZONE (Inclusion zones within a site for day-of-planting control)
# =============================================================================
class PlantingZone(models.Model):
    """
    PlantingZone: Subdivisions of a Site for day-of-planting control.
    User draws polygon zones on interactive map and reorders them via drag-drop.
    """
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='planting_zones')
    zone_code = models.IntegerField(db_index=True)
    name = models.CharField(max_length=255, blank=True)
    zone_boundary_polygon = models.JSONField()
    active = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['site', 'active']),
            models.Index(fields=['site', 'zone_code']),
        ]
        unique_together = [['site', 'zone_code']]

    def __str__(self):
        if self.name:
            return f"Zone {self.zone_code} - {self.name}"
        return f"Zone {self.zone_code}"


# =============================================================================
# PLANT
# =============================================================================
class Plant(models.Model):
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name='plants')
    planting_zone = models.ForeignKey(
        PlantingZone,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='plants'
    )
    species = models.ForeignKey(Species, on_delete=models.PROTECT, related_name='plants')
    seed_batch = models.ForeignKey(
        SeedBatch,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='plants'
    )
    date_planted = models.DateField(null=True, blank=True, db_index=True)

    # Coordinates inlined (unique per plant, avoids millions of joins)
    latitude = models.DecimalField(max_digits=10, decimal_places=7, db_index=True)
    longitude = models.DecimalField(max_digits=11, decimal_places=7, db_index=True)
    altitude = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    elevation = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    current_status = models.ForeignKey(
        PlantStatus,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='plants'
    )

    # Queue management fields
    queue_order = models.IntegerField(null=True, blank=True, db_index=True)
    original_plant = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='replants'
    )

    class Meta:
        indexes = [
            models.Index(fields=['site', 'current_status']),
            models.Index(fields=['site', 'queue_order']),
            models.Index(fields=['planting_zone', 'current_status']),
        ]

    @property
    def age_days(self):
        """Calculate age in days since planting. Returns None if date_planted is not set."""
        if self.date_planted:
            today = date.today()
            return (today - self.date_planted).days
        return None

    def __str__(self):
        return f"{self.species.cultivar if self.species else 'Unknown'} at {self.latitude}, {self.longitude}"


# =============================================================================
# SITE NOTE (Historical notes/comments for a site)
# =============================================================================
class SiteNote(models.Model):
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='notes')
    author = models.ForeignKey(User, on_delete=models.PROTECT, null=True, blank=True)
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        author_name = self.author.name if self.author else "Unknown"
        preview = self.content[:50] + "..." if len(self.content) > 50 else self.content
        return f"{self.site.name} - {author_name} ({self.timestamp.strftime('%Y-%m-%d')}): {preview}"


# =============================================================================
# SITE VISIT (Each time the site is visited - aggregates plant_visit data)
# =============================================================================
class SiteVisit(models.Model):
    VISIT_TYPE_PLANTING = 'planting'
    VISIT_TYPE_PROSPECTING = 'prospecting'
    VISIT_TYPE_INSPECTION = 'inspection'

    VISIT_TYPE_CHOICES = [
        (VISIT_TYPE_PLANTING, 'Planting'),
        (VISIT_TYPE_PROSPECTING, 'Prospecting'),
        (VISIT_TYPE_INSPECTION, 'Inspection'),
    ]

    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='visits', db_index=True)
    assigned_drone = models.ForeignKey(Drone, on_delete=models.PROTECT, related_name='site_visits')
    pilot = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='piloted_visits'
    )
    visit_type = models.CharField(
        max_length=20,
        choices=VISIT_TYPE_CHOICES,
        default=VISIT_TYPE_PROSPECTING
    )
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    duration_minutes = models.IntegerField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)

    # Denormalized counts
    plants_checked = models.IntegerField(default=0)
    plants_alive = models.IntegerField(default=0)
    plants_dead = models.IntegerField(default=0)
    fungi_applied = models.IntegerField(default=0)

    # Aggregated metrics for this visit
    total_co2_sequestered_kg = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True
    )
    avg_health_index = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    avg_plant_height_m = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    avg_canopy_width_m = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    avg_soil_moisture = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['site', 'timestamp']),
            models.Index(fields=['pilot', 'timestamp']),
        ]

    def __str__(self):
        pilot_name = self.pilot.name if self.pilot else "No pilot"
        return f"{self.site.name} - {self.get_visit_type_display()} by {pilot_name} ({self.timestamp.strftime('%Y-%m-%d')})"


# =============================================================================
# SITE VISIT CONTRIBUTOR (People present during a visit - User or guest)
# =============================================================================
class SiteVisitContributor(models.Model):
    ROLE_PILOT = 'pilot'
    ROLE_TECHNICIAN = 'technician'
    ROLE_GUEST = 'guest'

    ROLE_CHOICES = [
        (ROLE_PILOT, 'Drone Pilot'),
        (ROLE_TECHNICIAN, 'Technician'),
        (ROLE_GUEST, 'Guest'),
    ]

    site_visit = models.ForeignKey(
        SiteVisit,
        on_delete=models.CASCADE,
        related_name='contributors',
        db_index=True
    )
    role = models.CharField(max_length=50, choices=ROLE_CHOICES)

    # Option 1: Link to existing User (employee)
    user = models.ForeignKey(
        User,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='site_visit_participations'
    )

    # Option 2: Ad-hoc guest info (when user is NULL)
    guest_name = models.CharField(max_length=255, null=True, blank=True)
    guest_email = models.EmailField(max_length=255, null=True, blank=True)
    guest_phone = models.CharField(max_length=30, null=True, blank=True)
    guest_organization = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['site_visit', 'role']),
            models.Index(fields=['user']),
        ]

    def __str__(self):
        if self.user:
            return f"{self.user.name} ({self.get_role_display()}) - {self.site_visit.site.name}"
        elif self.guest_name:
            return f"{self.guest_name} (Guest {self.get_role_display()}) - {self.site_visit.site.name}"
        return f"Unknown Contributor ({self.get_role_display()})"


# =============================================================================
# PLANT VISIT (Status + measurements captured during a site visit)
# =============================================================================
class PlantVisit(models.Model):
    site_visit = models.ForeignKey(
        SiteVisit,
        on_delete=models.CASCADE,
        related_name='plant_visits',
        db_index=True
    )
    plant = models.ForeignKey(Plant, on_delete=models.CASCADE, related_name='visits', db_index=True)
    status = models.ForeignKey(PlantStatus, on_delete=models.PROTECT)
    height_m = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    health_index = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    canopy_width_m = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    soil_moisture_level = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    co2_sequestered_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    photo_evidence = models.JSONField(default=list, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['site_visit', 'plant']),
            models.Index(fields=['site_visit', 'status']),
        ]

    def __str__(self):
        species_name = self.plant.species.cultivar if self.plant.species else 'Unknown'
        return f"{species_name} - {self.status.name} (Visit {self.site_visit.timestamp.strftime('%Y-%m-%d')})"


# =============================================================================
# FUNGI VISIT (Fungi applied during a site visit)
# =============================================================================
class FungiVisit(models.Model):
    site_visit = models.ForeignKey(
        SiteVisit,
        on_delete=models.CASCADE,
        related_name='fungi_visits'
    )
    plant = models.ForeignKey(Plant, on_delete=models.CASCADE, related_name='fungi_visits')
    fungi_species = models.ForeignKey(Species, on_delete=models.PROTECT)
    fungi_batch = models.ForeignKey(
        FungiBatch,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='fungi_visits'
    )
    quantity_ml = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    def __str__(self):
        fungi_name = self.fungi_species.cultivar if self.fungi_species else 'Unknown fungi'
        plant_loc = f"{self.plant.latitude}, {self.plant.longitude}"
        return f"{fungi_name} applied to plant at {plant_loc} (Visit {self.site_visit.timestamp.strftime('%Y-%m-%d')})"


# =============================================================================
# SEED BATCH USAGE (Log when seeds from a batch are used at a site)
# =============================================================================
class SeedBatchUsage(models.Model):
    seed_batch = models.ForeignKey(
        SeedBatch,
        on_delete=models.PROTECT,
        related_name='usages'
    )
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='seed_usages')
    quantity_used_g = models.DecimalField(max_digits=10, decimal_places=2)
    seeds_planted_estimate = models.IntegerField(null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(null=True, blank=True)

    def __str__(self):
        return f"{self.seed_batch.qr_code} used at {self.site.name} ({self.quantity_used_g}g on {self.timestamp.strftime('%Y-%m-%d')})"


# =============================================================================
# FUNGI BATCH USAGE (Log when fungi from a batch are used at a site)
# =============================================================================
class FungiBatchUsage(models.Model):
    fungi_batch = models.ForeignKey(
        FungiBatch,
        on_delete=models.PROTECT,
        related_name='usages'
    )
    site = models.ForeignKey(Site, on_delete=models.CASCADE, related_name='fungi_usages')
    weight_used_grams = models.DecimalField(max_digits=10, decimal_places=2)
    quantity_used_ml = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    timestamp = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(null=True, blank=True)

    def __str__(self):
        return f"{self.fungi_batch.qr_code} used at {self.site.name} ({self.weight_used_grams}g on {self.timestamp.strftime('%Y-%m-%d')})"


# =============================================================================
# HELPER METHODS FOR AGGREGATION
# =============================================================================
def update_site_visit_aggregates(site_visit):
    """
    Calculate and update aggregated metrics for a SiteVisit from its PlantVisits.
    Call this after adding/updating PlantVisit records.
    """
    aggregates = site_visit.plant_visits.aggregate(
        total_co2=Sum('co2_sequestered_kg'),
        avg_health=Avg('health_index'),
        avg_height=Avg('height_m'),
        avg_canopy=Avg('canopy_width_m'),
        avg_moisture=Avg('soil_moisture_level'),
        plants_count=Count('id'),
        alive_count=Count('id', filter=Q(status__is_dead=False)),
        dead_count=Count('id', filter=Q(status__is_dead=True)),
    )

    fungi_count = site_visit.fungi_visits.count()

    site_visit.total_co2_sequestered_kg = aggregates['total_co2']
    site_visit.avg_health_index = aggregates['avg_health']
    site_visit.avg_plant_height_m = aggregates['avg_height']
    site_visit.avg_canopy_width_m = aggregates['avg_canopy']
    site_visit.avg_soil_moisture = aggregates['avg_moisture']
    site_visit.plants_checked = aggregates['plants_count'] or 0
    site_visit.plants_alive = aggregates['alive_count'] or 0
    site_visit.plants_dead = aggregates['dead_count'] or 0
    site_visit.fungi_applied = fungi_count
    site_visit.save(update_fields=[
        'total_co2_sequestered_kg', 'avg_health_index', 'avg_plant_height_m',
        'avg_canopy_width_m', 'avg_soil_moisture', 'plants_checked',
        'plants_alive', 'plants_dead', 'fungi_applied'
    ])


def update_site_totals_from_visits(site):
    """
    Update Site totals by aggregating from all SiteVisit records.
    Call this after updating SiteVisit aggregates.
    """
    # Get cumulative CO2 from all visits
    plant_visit_aggregates = PlantVisit.objects.filter(
        site_visit__site=site
    ).aggregate(
        cumulative_co2=Sum('co2_sequestered_kg'),
    )

    # Get latest visit for current averages
    latest_visit = site.visits.order_by('-timestamp').first()

    if latest_visit:
        site.avg_health_index = latest_visit.avg_health_index
        site.average_plant_height_m = latest_visit.avg_plant_height_m

    # Calculate CO2 breakdown
    total_co2 = int(plant_visit_aggregates['cumulative_co2'] or 0)

    # For now, assume 70% plant biomass, 30% soil sequestration
    site.total_co2_sequestered_kg = total_co2
    site.plant_co2_sequestered_kg = int(total_co2 * 0.7)
    site.soil_co2_sequestered_kg = int(total_co2 * 0.3)

    # Update plant counts from actual Plant records
    site.total_plants = site.plants.count()

    site.save(update_fields=[
        'avg_health_index', 'average_plant_height_m',
        'total_co2_sequestered_kg', 'soil_co2_sequestered_kg',
        'plant_co2_sequestered_kg', 'total_plants'
    ])


def update_project_totals_from_sites(project):
    """
    Update Project totals by aggregating from all Site records.
    Call this after updating site totals.
    """
    # Aggregate carbon data from all sites in this project
    site_aggregates = project.sites.aggregate(
        total_co2=Sum('total_co2_sequestered_kg'),
        soil_co2=Sum('soil_co2_sequestered_kg'),
        plant_co2=Sum('plant_co2_sequestered_kg'),
        total_plants=Sum('total_plants'),
    )

    # Update project totals
    project.total_co2_sequestered_kg = site_aggregates['total_co2'] or 0
    project.soil_co2_sequestered_kg = site_aggregates['soil_co2'] or 0
    project.plant_co2_sequestered_kg = site_aggregates['plant_co2'] or 0
    project.total_plants = site_aggregates['total_plants'] or 0

    project.save(update_fields=[
        'total_co2_sequestered_kg',
        'soil_co2_sequestered_kg',
        'plant_co2_sequestered_kg',
        'total_plants'
    ])
