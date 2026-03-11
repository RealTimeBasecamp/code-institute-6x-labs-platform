from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('planting', '0004_species_climate_zones_species_ecological_benefits_and_more'),
    ]

    operations = [
        # Add db_index to gbif_taxon_key (was added without index in 0004)
        migrations.AlterField(
            model_name='species',
            name='gbif_taxon_key',
            field=models.IntegerField(
                blank=True,
                db_index=True,
                help_text='GBIF taxon key for cross-referencing occurrence data',
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='species',
            name='gbif_image_url',
            field=models.URLField(
                blank=True,
                null=True,
                help_text='Cached GBIF square thumbnail URL',
            ),
        ),
        migrations.AddField(
            model_name='species',
            name='gbif_image_refreshed',
            field=models.DateTimeField(
                blank=True,
                null=True,
                help_text='When the GBIF image URL was last fetched/confirmed',
            ),
        ),
        migrations.AddField(
            model_name='species',
            name='uk_nativeness_cached',
            field=models.CharField(
                blank=True,
                choices=[
                    ('native', 'Native'),
                    ('naturalised', 'Naturalised'),
                    ('introduced', 'Introduced'),
                    ('unknown', 'Unknown'),
                ],
                max_length=20,
                null=True,
                help_text='UK nativeness from GBIF distributions, cached globally by taxon key',
            ),
        ),
        migrations.AddField(
            model_name='species',
            name='mixer_cached_data',
            field=models.JSONField(
                blank=True,
                null=True,
                help_text=(
                    'Cached payload from most recent mixer generation. '
                    'Keys: family, genus, subcategory, sources, observation_count, reason.'
                ),
            ),
        ),
    ]
