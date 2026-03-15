import json

from django.contrib.auth.decorators import login_required
from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_http_methods
from django.views.generic import ListView
from planting.models import Species

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
    Landing page — shows the UK map and the user's recent mixes.
    No mix is created here; clicking a card goes to species_mix_editor,
    clicking New Mix POSTs to species_mix_create.
    """
    recent_mixes = (
        SpeciesMix.objects
        .filter(owner=request.user)
        .order_by('-updated_at')[:20]
    )
    context = {
        'recent_mixes': recent_mixes,
        'is_superuser': request.user.is_superuser,
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
        ],
    }
    return render(request, 'species/species_mixer.html', context)


@login_required
@require_http_methods(['POST'])
def species_mix_create(request):
    """
    POST /species/mixer/new/
    Creates a new SpeciesMix with the user-supplied name and redirects
    to the editor page.  Called by the name wizard on the landing screen.
    Body (JSON or form): { name: '...' }
    """
    try:
        body = json.loads(request.body)
    except (ValueError, AttributeError):
        body = request.POST

    name = (body.get('name') or '').strip()
    if not name:
        count = SpeciesMix.objects.filter(owner=request.user).count()
        name = f'Species Mix #{count + 1}'

    mix = SpeciesMix.objects.create(owner=request.user, name=name)

    # JSON clients (fetch from JS) get the redirect URL back
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return JsonResponse({
            'mix_id': mix.pk,
            'redirect': reverse('species:species_mix_editor', args=[mix.pk]),
        })
    return redirect('species:species_mix_editor', mix_id=mix.pk)


@login_required
def species_mix_editor(request, mix_id):
    """
    Editor page for a specific mix.
    Loads the mix from the DB and renders the full editor template.
    404s if the mix doesn't belong to the current user.
    """
    mix = get_object_or_404(SpeciesMix, pk=mix_id, owner=request.user)
    context = {
        'mix': mix,
        'mix_id': mix.pk,
        'mix_name': mix.name,
        'is_superuser': request.user.is_superuser,
        'breadcrumbs': [
            {
                'label': 'Species',
                'url': reverse('species:species_list'),
                'is_current': False,
                'is_ellipsis': False,
            },
            {
                'label': 'Mixer',
                'url': reverse('species:species_mixer'),
                'is_current': False,
                'is_ellipsis': False,
            },
            {
                'label': mix.name,
                'url': None,
                'is_current': True,
                'is_ellipsis': False,
            },
        ],
    }
    return render(request, 'species/species_mix_editor.html', context)


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
