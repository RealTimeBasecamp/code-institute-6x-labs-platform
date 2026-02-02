from django.db import models

from users.models import User
from planting.models import Species
from species.models import SeedBatch, FungiBatch


# =============================================================================
# DRONE
# =============================================================================
class Drone(models.Model):
    serial_number = models.CharField(max_length=100, unique=True)
    nickname = models.CharField(max_length=100, db_index=True)
    model = models.CharField(max_length=100)
    manufacturer = models.CharField(max_length=100, null=True, blank=True)
    total_flight_time_minutes = models.IntegerField(default=0)
    avg_battery_life_minutes = models.IntegerField(null=True, blank=True)
    last_maintenance = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f"{self.nickname} ({self.model})"


# =============================================================================
# DRONE MAINTENANCE LOG (Maintenance history for drones - MOT style)
# =============================================================================
class DroneMaintenanceLog(models.Model):
    # Result choices (MOT style)
    RESULT_PASS = 'pass'
    RESULT_ADVISORY = 'advisory'
    RESULT_FAULT = 'fault'

    RESULT_CHOICES = [
        (RESULT_PASS, 'Pass - No Issues'),
        (RESULT_ADVISORY, 'Advisory - Recommend Attention'),
        (RESULT_FAULT, 'Fault - Requires Repair'),
    ]

    drone = models.ForeignKey(Drone, on_delete=models.CASCADE, related_name='maintenance_logs')
    performed_by = models.ForeignKey(User, on_delete=models.PROTECT, related_name='drone_maintenance_performed')
    result = models.CharField(max_length=20, choices=RESULT_CHOICES)
    timestamp = models.DateTimeField(auto_now_add=True)
    description = models.TextField()
    advisory_notes = models.TextField(null=True, blank=True)
    parts_replaced = models.TextField(null=True, blank=True)
    next_maintenance_due = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['drone', 'timestamp']),
            models.Index(fields=['drone', 'result']),
        ]

    def __str__(self):
        return f"{self.drone.nickname} - {self.get_result_display()} ({self.timestamp.strftime('%Y-%m-%d')})"


# =============================================================================
# DRONE FLIGHT LOG (Flight history with pathfinding per species)
# =============================================================================
class DroneFlightLog(models.Model):
    drone = models.ForeignKey(Drone, on_delete=models.PROTECT, related_name='flight_logs')
    site = models.ForeignKey('projects.Site', on_delete=models.CASCADE, related_name='flight_logs')
    species = models.ForeignKey(
        Species,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='drone_flight_logs'
    )
    seed_batch = models.ForeignKey(
        SeedBatch,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='flight_logs'
    )
    fungi_batch = models.ForeignKey(
        FungiBatch,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name='flight_logs'
    )
    timestamp = models.DateTimeField(auto_now_add=True)
    flight_duration_minutes = models.IntegerField()
    pathfinding_coordinates = models.JSONField(default=list, blank=True)
    plants_planted = models.IntegerField(default=0)
    notes = models.TextField(null=True, blank=True)

    def __str__(self):
        species_str = f" - {self.species.cultivar}" if self.species else ""
        return f"{self.drone.nickname} at {self.site.name}{species_str} ({self.timestamp.strftime('%Y-%m-%d')})"
