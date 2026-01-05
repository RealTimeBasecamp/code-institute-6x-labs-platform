from decimal import Decimal

from django.db import models
from django.db.models import Avg, Sum, Count, Q  # noqa: F401 - used in helper functions

from core.models import Species


# =============================================================================
# GLOBAL METRICS (Aggregated metrics across all projects)
# =============================================================================
class GlobalMetrics(models.Model):
    """
    Singleton model that stores global metrics including carbon sequestration,
    plants, sites, and projects.
    Updated periodically or on-demand to aggregate data from all projects.
    Only one record should exist in this table.
    """
    # Timestamp of last calculation
    last_updated = models.DateTimeField(auto_now=True)
    calculation_timestamp = models.DateTimeField(auto_now_add=True)

    # Total metrics (including archived projects/sites if status.includes_in_carbon=True)
    total_projects = models.IntegerField(default=0)
    active_projects = models.IntegerField(default=0)
    archived_projects = models.IntegerField(default=0)

    total_sites = models.IntegerField(default=0)
    active_sites = models.IntegerField(default=0)
    archived_sites = models.IntegerField(default=0)

    total_plants = models.BigIntegerField(default=0)
    total_plants_alive = models.BigIntegerField(default=0)
    total_plants_dead = models.BigIntegerField(default=0)

    # Carbon metrics (only from projects/sites where status.includes_in_carbon=True)
    total_co2_sequestered_kg = models.BigIntegerField(default=0)
    soil_co2_sequestered_kg = models.BigIntegerField(default=0)
    plant_co2_sequestered_kg = models.BigIntegerField(default=0)

    # Additional metrics
    total_land_hectares = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00')
    )
    avg_global_health_index = models.DecimalField(
        max_digits=4,
        decimal_places=2,
        null=True,
        blank=True
    )

    class Meta:
        verbose_name = "Global Metrics"
        verbose_name_plural = "Global Metrics"

    def __str__(self):
        return f"Global Metrics (Updated: {self.last_updated.strftime('%Y-%m-%d %H:%M')})"

    def save(self, *args, **kwargs):
        """Ensure only one instance exists (singleton pattern)"""
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def get_instance(cls):
        """Get or create the singleton instance"""
        instance, created = cls.objects.get_or_create(pk=1)
        return instance


# =============================================================================
# SITE SPECIES METRICS (Analytics table for species performance per site)
# =============================================================================
class SiteSpeciesMetrics(models.Model):
    """
    Denormalized analytics table for species performance per site.
    Updated periodically via background job - not real-time.
    Enables fast filtering/comparison without polluting core models.
    """
    site = models.ForeignKey(
        'projects.Site',
        on_delete=models.CASCADE,
        related_name='species_metrics'
    )
    species = models.ForeignKey(
        Species,
        on_delete=models.CASCADE,
        related_name='site_metrics'
    )

    # Snapshot metrics (calculated at last_calculated timestamp)
    total_planted = models.IntegerField(default=0)
    total_alive = models.IntegerField(default=0)
    total_dead = models.IntegerField(default=0)
    survival_rate_percentage = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True
    )

    avg_height_m = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    avg_health_index = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True)
    avg_age_days = models.IntegerField(null=True, blank=True)

    # Metadata
    last_calculated = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Site Species Metrics"
        unique_together = [['site', 'species']]
        indexes = [
            models.Index(fields=['site', 'survival_rate_percentage']),
            models.Index(fields=['species', 'survival_rate_percentage']),
        ]

    def __str__(self):
        rate = f"{self.survival_rate_percentage}%" if self.survival_rate_percentage else "N/A"
        return f"{self.species.cultivar} at {self.site.name} - {rate} survival"


# =============================================================================
# HELPER FUNCTIONS FOR METRICS CALCULATION
# =============================================================================
def update_global_metrics():
    """
    Calculate and update global metrics from all projects and sites.
    Only includes sites where both site.status.includes_in_carbon=True
    and project.status.includes_in_carbon=True.

    Call this periodically or after significant data changes.
    """
    from projects.models import Project, Site, Plant

    metrics = GlobalMetrics.get_instance()

    # Count all projects
    total_projects = Project.objects.count()
    active_projects = Project.objects.filter(status__is_archived=False).count()
    archived_projects = Project.objects.filter(status__is_archived=True).count()

    # Count all sites
    total_sites = Site.objects.count()
    active_sites = Site.objects.filter(status__is_archived=False).count()
    archived_sites = Site.objects.filter(status__is_archived=True).count()

    # Get sites that should be included in carbon calculations
    included_sites = Site.objects.filter(
        status__includes_in_carbon=True,
        project__status__includes_in_carbon=True
    )

    # Aggregate carbon data from included sites
    carbon_aggregates = included_sites.aggregate(
        total_co2=Sum('total_co2_sequestered_kg'),
        soil_co2=Sum('soil_co2_sequestered_kg'),
        plant_co2=Sum('plant_co2_sequestered_kg'),
        total_land=Sum('total_available_land_hectares'),
        avg_health=Avg('avg_health_index'),
    )

    # Count all plants
    plant_counts = Plant.objects.aggregate(
        total=Count('id'),
        alive=Count('id', filter=Q(current_status__is_dead=False)),
        dead=Count('id', filter=Q(current_status__is_dead=True)),
    )

    # Update metrics
    metrics.total_projects = total_projects
    metrics.active_projects = active_projects
    metrics.archived_projects = archived_projects

    metrics.total_sites = total_sites
    metrics.active_sites = active_sites
    metrics.archived_sites = archived_sites

    metrics.total_plants = plant_counts['total'] or 0
    metrics.total_plants_alive = plant_counts['alive'] or 0
    metrics.total_plants_dead = plant_counts['dead'] or 0

    metrics.total_co2_sequestered_kg = int(carbon_aggregates['total_co2'] or 0)
    metrics.soil_co2_sequestered_kg = int(carbon_aggregates['soil_co2'] or 0)
    metrics.plant_co2_sequestered_kg = int(carbon_aggregates['plant_co2'] or 0)

    metrics.total_land_hectares = carbon_aggregates['total_land'] or 0
    metrics.avg_global_health_index = carbon_aggregates['avg_health']

    metrics.save()

    return metrics


def update_site_species_metrics(site):
    """
    Calculate and update species performance metrics for a site.
    Call periodically (e.g., nightly batch job) or after significant data changes.
    """
    from datetime import date
    from projects.models import Plant, PlantVisit

    # Get all species planted at this site with aggregated stats
    species_stats = Plant.objects.filter(site=site).values('species').annotate(
        total_planted=Count('id'),
        total_alive=Count('id', filter=Q(current_status__is_dead=False)),
        total_dead=Count('id', filter=Q(current_status__is_dead=True)),
    )

    for stats in species_stats:
        species = Species.objects.get(id=stats['species'])

        # Calculate survival rate
        survival_rate = None
        if stats['total_planted'] > 0:
            survival_rate = (stats['total_alive'] / stats['total_planted']) * 100

        # Get average metrics from latest plant visits for this species at this site
        plant_metrics = PlantVisit.objects.filter(
            plant__site=site,
            plant__species=species
        ).aggregate(
            avg_height=Avg('height_m'),
            avg_health=Avg('health_index'),
        )

        # Calculate average age for alive plants of this species
        alive_plants = Plant.objects.filter(
            site=site,
            species=species,
            current_status__is_dead=False,
            date_planted__isnull=False
        )

        avg_age = None
        if alive_plants.exists():
            today = date.today()
            ages = [(today - p.date_planted).days for p in alive_plants if p.date_planted]
            avg_age = sum(ages) // len(ages) if ages else None

        # Update or create metrics record
        SiteSpeciesMetrics.objects.update_or_create(
            site=site,
            species=species,
            defaults={
                'total_planted': stats['total_planted'],
                'total_alive': stats['total_alive'],
                'total_dead': stats['total_dead'],
                'survival_rate_percentage': survival_rate,
                'avg_height_m': plant_metrics['avg_height'],
                'avg_health_index': plant_metrics['avg_health'],
                'avg_age_days': avg_age,
            }
        )
