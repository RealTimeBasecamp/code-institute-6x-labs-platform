"""
Admin configuration for the planting app.

Registers PlantStatus and Species models with the Django admin.

Species admin includes:
  - Ecological attribute fieldsets (soil, climate, range, benefits)
  - CSV import action for bulk-loading ecological data from BSBI/NBN exports
"""
import csv
import io
import logging

from django.contrib import admin, messages
from django.utils.html import format_html

from core.utils.parsers import pipe_separated_list, safe_float, safe_int

from .models import EditorPreferences, PlantStatus, Species

logger = logging.getLogger(__name__)


@admin.register(PlantStatus)
class PlantStatusAdmin(admin.ModelAdmin):
    """Admin configuration for PlantStatus model."""

    list_display = ['emoji', 'name', 'code', 'category', 'is_dead', 'display_order']
    list_filter = ['is_dead', 'category']
    ordering = ['display_order']


@admin.register(Species)
class SpeciesAdmin(admin.ModelAdmin):
    """Admin configuration for Species model with ecological attributes."""

    list_display = [
        'common_name', 'scientific_name', 'category',
        'uk_nativeness_cached', 'gbif_image_refreshed',
        'ecological_benefits_display', 'gbif_taxon_key',
    ]
    list_filter = [
        'category', 'soil_moisture', 'shade_tolerance', 'uk_nativeness_cached',
    ]
    search_fields = ['cultivar', 'common_name', 'scientific_name']
    actions = ['import_ecological_csv']

    fieldsets = (
        ('Identity', {
            'fields': ('category', 'cultivar', 'common_name', 'scientific_name'),
        }),
        ('Planting Specifications', {
            'fields': ('hole_size_mm', 'hole_depth_mm', 'spacing_mm', 'typical_spacing_m'),
            'classes': ('collapse',),
        }),
        ('Soil Preferences', {
            'fields': ('soil_types', 'soil_ph_min', 'soil_ph_max', 'soil_moisture', 'shade_tolerance'),
            'description': (
                'soil_types: JSON list, e.g. ["clay", "loamy", "peaty"]. '
                'Valid values: clay, sandy, loamy, silty, peaty, chalky.'
            ),
        }),
        ('Climate Preferences', {
            'fields': ('climate_zones', 'min_annual_rainfall_mm', 'max_annual_rainfall_mm', 'min_temp_c'),
            'description': (
                'climate_zones: JSON list, e.g. ["temperate", "continental"]. '
                'min_temp_c: coldest winter temperature the species can tolerate (°C).'
            ),
        }),
        ('Ecological Benefits & Native Range', {
            'fields': ('ecological_benefits', 'native_regions', 'gbif_taxon_key'),
            'description': (
                'ecological_benefits: JSON list from: pollinator, erosion_control, '
                'carbon_sequestration, wildlife_habitat, biodiversity. '
                'native_regions: JSON list from: scotland, england, wales, ireland, europe.'
            ),
        }),
        ('Mixer Cache (auto-populated)', {
            'fields': (
                'gbif_image_url', 'gbif_image_refreshed',
                'uk_nativeness_cached', 'mixer_cached_data',
            ),
            'description': (
                'Populated automatically by the species mixer after each generation. '
                'gbif_image_refreshed: set to null to force a 90-day image refresh. '
                'mixer_cached_data: JSON payload (family, genus, subcategory, sources, etc.).'
            ),
            'classes': ('collapse',),
        }),
    )

    @admin.display(description='Ecological Benefits')
    def ecological_benefits_display(self, obj):
        benefits = obj.ecological_benefits or []
        if not benefits:
            return '—'
        colours = {
            'pollinator': '#dc3545',
            'erosion_control': '#198754',
            'carbon_sequestration': '#0dcaf0',
            'wildlife_habitat': '#ffc107',
            'biodiversity': '#0d6efd',
        }
        badges = ' '.join(
            format_html(
                '<span style="background:{};color:#fff;padding:1px 6px;border-radius:3px;'
                'font-size:0.75em;">{}</span>',
                colours.get(b, '#6c757d'),
                b.replace('_', ' ').title(),
            )
            for b in benefits
        )
        return format_html(badges)

    @admin.action(description='Import ecological attributes from CSV')
    def import_ecological_csv(self, request, queryset):
        """
        Bulk-import ecological attributes from a CSV file upload.

        Expected CSV columns (header row required):
          scientific_name, soil_ph_min, soil_ph_max, soil_types, soil_moisture,
          climate_zones, min_annual_rainfall_mm, max_annual_rainfall_mm, min_temp_c,
          shade_tolerance, ecological_benefits, native_regions, gbif_taxon_key,
          typical_spacing_m

        soil_types, climate_zones, ecological_benefits, native_regions:
          pipe-separated values, e.g. "clay|loamy|peaty"
        """
        import_file = request.FILES.get('csv_file')
        if not import_file:
            self.message_user(
                request,
                'No CSV file uploaded. Use the "Import ecological CSV" action with a file attached.',
                level=messages.WARNING,
            )
            return

        try:
            content = import_file.read().decode('utf-8-sig')
            reader = csv.DictReader(io.StringIO(content))
            updated = 0
            skipped = 0

            for row in reader:
                sci_name = row.get('scientific_name', '').strip()
                if not sci_name:
                    skipped += 1
                    continue

                try:
                    species = Species.objects.get(scientific_name__iexact=sci_name)
                except Species.DoesNotExist:
                    logger.warning("CSV import: Species '%s' not found in DB — skipping.", sci_name)
                    skipped += 1
                    continue
                except Species.MultipleObjectsReturned:
                    logger.warning("CSV import: Multiple species for '%s' — skipping.", sci_name)
                    skipped += 1
                    continue

                if row.get('soil_ph_min'): species.soil_ph_min = safe_float(row['soil_ph_min'])
                if row.get('soil_ph_max'): species.soil_ph_max = safe_float(row['soil_ph_max'])
                if row.get('soil_types'): species.soil_types = pipe_separated_list(row['soil_types'])
                if row.get('soil_moisture'): species.soil_moisture = row['soil_moisture'].strip()
                if row.get('shade_tolerance'): species.shade_tolerance = row['shade_tolerance'].strip()
                if row.get('climate_zones'): species.climate_zones = pipe_separated_list(row['climate_zones'])
                if row.get('min_annual_rainfall_mm'): species.min_annual_rainfall_mm = safe_int(row['min_annual_rainfall_mm'])
                if row.get('max_annual_rainfall_mm'): species.max_annual_rainfall_mm = safe_int(row['max_annual_rainfall_mm'])
                if row.get('min_temp_c'): species.min_temp_c = safe_float(row['min_temp_c'])
                if row.get('ecological_benefits'): species.ecological_benefits = pipe_separated_list(row['ecological_benefits'])
                if row.get('native_regions'): species.native_regions = parse_list(row['native_regions'])
                if row.get('gbif_taxon_key'): species.gbif_taxon_key = parse_int(row['gbif_taxon_key'])
                if row.get('typical_spacing_m'): species.typical_spacing_m = parse_float(row['typical_spacing_m'])

                species.save()
                updated += 1

            self.message_user(
                request,
                f'CSV import complete: {updated} species updated, {skipped} skipped.',
                level=messages.SUCCESS if updated else messages.WARNING,
            )
        except Exception as exc:
            logger.exception("CSV import failed: %s", exc)
            self.message_user(request, f'CSV import failed: {exc}', level=messages.ERROR)


@admin.register(EditorPreferences)
class EditorPreferencesAdmin(admin.ModelAdmin):
    """Admin configuration for EditorPreferences model."""

    list_display = ['user', 'ui_scale', 'auto_topdown_drawing']
    search_fields = ['user__username', 'user__email']
    raw_id_fields = ['user']
