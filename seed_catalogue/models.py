from django.db import models

from core.models import Species


# =============================================================================
# SEED BATCH (Catalogued batch of seeds with QR code tracking and compliance)
# =============================================================================
class SeedBatch(models.Model):
    # Stratification status choices
    STRATIFICATION_NOT_REQUIRED = 'not_required'
    STRATIFICATION_IN_PROGRESS = 'in_progress'
    STRATIFICATION_COMPLETE = 'complete'

    STRATIFICATION_CHOICES = [
        (STRATIFICATION_NOT_REQUIRED, 'Not Required'),
        (STRATIFICATION_IN_PROGRESS, 'In Progress'),
        (STRATIFICATION_COMPLETE, 'Complete'),
    ]

    species = models.ForeignKey(Species, on_delete=models.PROTECT, related_name='seed_batches')
    qr_code = models.CharField(max_length=100, unique=True)
    batch_date = models.DateTimeField(db_index=True)

    # Supplier info
    supplier_name = models.CharField(max_length=255)
    supplier_contact = models.CharField(max_length=255, null=True, blank=True)

    # Compliance info (FRM - Forest Reproductive Material)
    compliance_type = models.CharField(max_length=100, default="Forest Reproductive Material (FRM)")
    nrid = models.CharField(max_length=50, null=True, blank=True)  # National Register ID
    ngr = models.CharField(max_length=50, null=True, blank=True)  # National Grid Reference
    basic_material = models.CharField(max_length=100, null=True, blank=True)
    master_certificate = models.CharField(max_length=100, null=True, blank=True)

    # Batch details
    weight_grams = models.DecimalField(max_digits=10, decimal_places=2)
    seed_count_estimate = models.IntegerField(null=True, blank=True)
    syringe_size_mm = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    # Stratification
    stratification_status = models.CharField(
        max_length=20,
        choices=STRATIFICATION_CHOICES,
        default=STRATIFICATION_NOT_REQUIRED
    )
    stratification_start_date = models.DateTimeField(null=True, blank=True)
    stratification_end_date = models.DateTimeField(null=True, blank=True)
    shelf_location = models.CharField(max_length=100, null=True, blank=True)

    # Quality testing
    quality_test_passed = models.BooleanField(default=False)
    quality_test_notes = models.TextField(null=True, blank=True)
    xray_embryo_tested = models.BooleanField(default=False)

    # Media & status
    photos = models.JSONField(default=list, blank=True)
    is_depleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Seed Batches"

    def __str__(self):
        return f"{self.qr_code} - {self.species.cultivar if self.species else 'Unknown'}"


# =============================================================================
# FUNGI BATCH (Catalogued batch of fungi with QR code tracking and compliance)
# =============================================================================
class FungiBatch(models.Model):
    species = models.ForeignKey(Species, on_delete=models.PROTECT, related_name='fungi_batches')
    qr_code = models.CharField(max_length=100, unique=True)
    batch_date = models.DateTimeField(db_index=True)
    supplier_name = models.CharField(max_length=255)
    supplier_contact = models.CharField(max_length=255, null=True, blank=True)
    quantity_ml = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    shelf_location = models.CharField(max_length=100, null=True, blank=True)
    quality_test_passed = models.BooleanField(default=False)
    quality_test_notes = models.TextField(null=True, blank=True)
    photos = models.JSONField(default=list, blank=True)
    is_depleted = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name_plural = "Fungi Batches"

    def __str__(self):
        return f"{self.qr_code} - {self.species.cultivar if self.species else 'Unknown'}"
