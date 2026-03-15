from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('species', '0005_add_is_published_to_speciesmix'),
    ]

    operations = [
        migrations.AddField(
            model_name='speciesmix',
            name='mixer_settings',
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text='User-configured generation settings: search_radius_km, natives_only, api_sources, category_targets, score_factors, active_preset',
            ),
        ),
    ]
