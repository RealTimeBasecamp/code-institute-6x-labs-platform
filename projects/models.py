from datetime import date
from decimal import Decimal

from django.db import models
from django.db.models import Avg, Sum, Count, Q

from core.models import Status, PlantStatus, Species, Address, Contact, Coordinate
from users.models import User
from seed_catalogue.models import SeedBatch, FungiBatch
from drones.models import Drone


# =============================================================================
# PROJECT
# =============================================================================
class Project(models.Model):
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
    coordinates = models.ForeignKey(Coordinate, on_delete=models.PROTECT)

    # e.g. Private Land, Public Land, Reforestation Project
    project_type = models.CharField(max_length=100)

    # e.g. Clay, Sandy, Silty, Peaty, Chalky, Loamy
    soil_type = models.CharField(max_length=50)

    # e.g. Tropical, Dry, Temperate, Continental, Polar
    climate = models.CharField(max_length=50)
    area_hectares = models.DecimalField(max_digits=10, decimal_places=2)

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

    def __str__(self):
        return self.name


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
        return f"{self.name} ({self.project.name if self.project else 'No Project'})"


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
