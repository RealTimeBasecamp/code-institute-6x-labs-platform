from django.shortcuts import get_object_or_404, render
from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin
from django.urls import reverse
from planting.models import Species
from django.views.generic import ListView

from species.models import SpeciesMix


class SpeciesListView(LoginRequiredMixin, ListView):
    """
    Species catalogue — auto-populated by the species mixer.
    Shows all Species rows that have been enriched by at least one mixer
    generation (mixer_cached_data is set). Grows automatically over time
    as more locations are generated.
    """
    model = Species
    template_name = 'species/species_list.html'
    context_object_name = 'species_list'
    paginate_by = 50

    def get_queryset(self):
        qs = Species.objects.filter(
            mixer_cached_data__isnull=False,
        ).order_by('category', 'common_name')
        q = self.request.GET.get('q', '').strip()
        if q:
            from django.db.models import Q
            qs = qs.filter(
                Q(common_name__icontains=q) | Q(scientific_name__icontains=q)
            )
        cat = self.request.GET.get('category', '').strip()
        if cat:
            qs = qs.filter(category__iexact=cat)
        return qs

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        ctx['search_q'] = self.request.GET.get('q', '')
        ctx['filter_category'] = self.request.GET.get('category', '')
        ctx['categories'] = (
            Species.objects.filter(mixer_cached_data__isnull=False)
            .values_list('category', flat=True)
            .distinct()
            .order_by('category')
        )
        ctx['total_cached'] = Species.objects.filter(
            mixer_cached_data__isnull=False
        ).count()
        return ctx


@login_required
def species_detail(request, common_name):
    """
    Per-species detail view. Accessible at path 'species/<name>/', named 'species_detail'.
    Only accessible to logged-in users.
    """
    species = get_object_or_404(Species, common_name=common_name)
    context = {
        'species': species,
        'breadcrumbs': [
            {
                'label': 'Species',
                'url': reverse('species:species_list'),
                'is_current': False,
                'is_ellipsis': False,
            },
        ]
    }

    context['breadcrumbs'].append({
        'label': species.common_name,
        'url': None,
        'is_current': True,
        'is_ellipsis': False,
    })

    return render(request, 'species/species_detail.html', context)


def _auto_mix_name(user):
    """Return an auto-generated name like 'Species Mix #3' for a new mix."""
    count = SpeciesMix.objects.filter(owner=user).count()
    return f'Species Mix #{count + 1}'


@login_required
def species_mix_list(request):
    """
    Species mixer page -- progressive wizard for AI-driven mix generation.

    On GET without a mix_id query parameter, auto-creates a new SpeciesMix
    (blank, no location or items yet) and injects its ID + name so the frontend
    can immediately start saving edits to the correct record.

    Accepts ?mix_id=<id> to re-open an existing mix.
    """
    mix_id = request.GET.get('mix_id')
    current_mix = None

    if mix_id:
        try:
            current_mix = SpeciesMix.objects.get(pk=mix_id, owner=request.user)
        except SpeciesMix.DoesNotExist:
            pass

    if current_mix is None:
        current_mix = SpeciesMix.objects.create(
            owner=request.user,
            name=_auto_mix_name(request.user),
        )

    recent_mixes = SpeciesMix.objects.filter(owner=request.user).order_by('-updated_at')[:8]
    context = {
        'current_mix_id': current_mix.pk,
        'current_mix_name': current_mix.name,
        'recent_mixes': recent_mixes,
        'breadcrumbs': [
            {
                'label': 'Species',
                'url': reverse('species:species_list'),
                'is_current': False,
                'is_ellipsis': False,
            },
            {
                'label': 'Mixer',
                'url': None,
                'is_current': True,
                'is_ellipsis': False,
            },
        ]
    }
    return render(request, 'species/species_mixer.html', context)


@login_required
def species_mix(request, mix_name):
    species = get_object_or_404(Species, common_name=mix_name)
    context = {
        'species': species,
        'breadcrumbs': [
            {
                'label': 'Species',
                'url': reverse('species:species_list'),
                'is_current': False,
                'is_ellipsis': False,
            },
            {
                'label': species.common_name or species.cultivar,
                'url': reverse('species:species_detail', args=[species.common_name]),
                'is_current': False,
                'is_ellipsis': False,
            },
        ]
    }
    context['breadcrumbs'].append({
        'label': f'{species.common_name or species.cultivar} Mix',
        'url': None,
        'is_current': True,
        'is_ellipsis': False,
    })
    return render(request, 'species/species_mix_list.html', context)
