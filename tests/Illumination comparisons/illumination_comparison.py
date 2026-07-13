#!/usr/bin/env python3
"""
plot_mc_comparison.py — 4x2 comparison figure for two mc_cloud_rt_v4 JSON exports.

Rows:
  (1) exit-angle |mu| histogram          (flux/energy: fraction of photons per bin)
  (2) optical path-length distribution   (flux/energy: fraction of photons per bin)
  (3) BDF vs exit zenith, phi-averaged    (dimensionless BDF, ∝ radiance; absolute)
  (4) BDF polar heatmap                    (dimensionless BDF, ∝ radiance;
                                           zenith=radius, azimuth=angle), shown for
                                           BOTH runs per channel, matching the
                                           browser BDF panel style.
Columns (rows 1-3): (left) Reflected, (right) Net transmitted (surface-deposited).

NOTE on units: rows 1-2 are FLUX (photon-count) distributions; rows 3-4 are the
dimensionless BDF, a reflectance-factor-type quantity PROPORTIONAL to radiance
(pi*L/F0) -- not radiance itself, so no radiance unit is implied.
The two are consistent but not identical representations of the same
exit directions, related by (1/N) dN/dmu = 2*mu*BDF_avg(theta) (mu=cosTheta) —
the cosTheta is a y-axis flux<->radiance weighting, not an x-axis change.
The mu/path rows are area-normalized (shape comparison); the BDF rows are kept
ABSOLUTE (a normalized radiometric quantity). BDF is the UNSMOOTHED export grid.
At oblique Theta0 the phi-average (row 3) collapses real azimuthal structure;
the polar heatmap (row 4) preserves it.

Requires: numpy, matplotlib, and mc_export_reader.py (repo root, located
automatically via the sys.path insert below — no copy needed).
Edit the CONFIG block, then:  python illumination_comparison.py
"""
import sys, pathlib
# Make the canonical mc_export_reader.py (repo root, two levels up from this
# tests/<...>/ script) importable regardless of the working directory.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

import numpy as np, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.patches import Patch
from matplotlib.cm import ScalarMappable
from matplotlib.colors import Normalize
from matplotlib.transforms import ScaledTranslation
from mc_export_reader import MCExport

# ============================ CONFIG ============================
FILE_A   = 'center_point_illumination_test_theta0=0.json'      # first run
FILE_B   = 'uniform_top_illumination_test_theta0=0.json'       # second run
LABEL_A  = 'centered (pencil)'
LABEL_B  = 'uniform top'
COLOR_A  = '#2563eb'                   # blue (bar rows)
COLOR_B  = '#dc2626'                   # red  (bar rows)
ALPHA    = 0.55
POLAR_CMAP = 'turbo'                   # browser-like colormap for row 4
POLAR_PCTILE = 95                      # colorbar max = this percentile of BDF (robust to hot bins)
OUTFILE  = 'illumination_comparison_test_theta0=0.png'
SUPTITLE = ('Pencil vs uniform-top illumination\n'
            'COT τ=10,  g=0.85,  ω₀=1.00,  A$_s$=0,  extent=40,  Θ₀=0°,  N=2×10⁶,  seed 42')
# ===============================================================

# Optional CLI overrides (v6.0.1): with no arguments the CONFIG block above is
# used unchanged, so historical invocation still works. With arguments, every
# figure variant can be batch-generated without editing the file:
#   python illumination_comparison.py --file-a a.json --file-b b.json \
#     --label-a "uniform top" --label-b "uniform domain M=4" \
#     --outfile out.png --suptitle "..." [--transmitted-cloud-only]
import argparse
_p = argparse.ArgumentParser(add_help=True)
_p.add_argument('--file-a');  _p.add_argument('--file-b')
_p.add_argument('--label-a'); _p.add_argument('--label-b')
_p.add_argument('--outfile'); _p.add_argument('--suptitle')
_p.add_argument('--transmitted-cloud-only', action='store_true',
                help='Use the *_cloud_only net-transmitted arrays (schema >= 1.2, '
                     'Uniform-domain runs): excludes the clear-sky-direct delta '
                     'spike, matching what the in-app panels plot.')
_p.add_argument('--brf', action='store_true',
                help='Plot the rigorous BRF/BTF grids (schema >= 1.3, Phase 4: '
                     'normalized by realized N_top and, under side-inclusive '
                     'observation, A_proj) in rows 3-4 instead of the N-normalized '
                     'BDF. Matches the in-app panels. Ignored (with a warning) if '
                     'combined with --entire-domain, whose domain-mean view is '
                     'deliberately N-normalized.')
_p.add_argument('--entire-domain', action='store_true',
                help='Match the in-app "Show entire-domain plots" toggle (schema '
                     '>= 1.2, Uniform-domain runs): Reflected uses the domain-wide '
                     'arrays (side exits + surface bypass, dropdown-independent); '
                     'Net transmitted uses the domain-wide cloud-only arrays. '
                     'Legacy exports carry no such arrays and pass through unchanged.')
_args = _p.parse_args()
FILE_A   = _args.file_a   or FILE_A
FILE_B   = _args.file_b   or FILE_B
LABEL_A  = _args.label_a  or LABEL_A
LABEL_B  = _args.label_b  or LABEL_B
OUTFILE  = _args.outfile  or OUTFILE
SUPTITLE = _args.suptitle.replace('\\n', '\n') if _args.suptitle else SUPTITLE

A = MCExport.load(FILE_A); B = MCExport.load(FILE_B)

# --transmitted-cloud-only: swap the net-transmitted mu histogram and BDF grid
# for their cloud-only (clear-direct-excluded) variants where the export
# carries them (Uniform-domain runs, schema >= 1.2). The raw arrays include the
# unscattered clear-sky-direct population -- a delta function at exactly Theta0
# confined to one bin -- which no shared axis/color scale can display
# proportionally; the in-app panels plot the cloud-only view for the same
# reason. Legacy exports carry no such arrays and are passed through unchanged
# (their raw arrays ARE the cloud-only population). The BDF is renormalized
# from the cloud-only weights with the same (W/N)*pi/(mu*dmu*dphi) formula.
def _bdf_from_weights(bd, W):
    """Renormalize a raw weight grid with the export's own BDF formula."""
    W = np.asarray(W, float)
    mu_c = np.asarray(bd['mu_centers'], float)[:, None]
    dmu  = np.asarray(bd['delta_mu'], float)[:, None]
    return (W / bd['N_incident']) * np.pi / (mu_c * dmu * bd['delta_phi_rad'])

if _args.transmitted_cloud_only or _args.entire_domain:
    for exp in (A, B):
        mh, bd = exp.raw['mu_histograms'], exp.raw['bdf']
        # Net transmitted: cloud-only (default view) or domain-wide cloud-only
        # (entire-domain view) -- both exclude the clear-sky-direct delta spike,
        # exactly as the in-app panels do.
        t_key = ('net_transmitted_counts_domain_wide_cloud_only' if _args.entire_domain
                 else 'net_transmitted_counts_cloud_only')
        w_key = ('net_transmitted_weights_domain_wide_cloud_only' if _args.entire_domain
                 else 'net_transmitted_weights_cloud_only')
        if t_key in mh:
            mh['net_transmitted_counts'] = mh[t_key]
        if w_key in bd:
            bd['net_transmitted_bdf'] = _bdf_from_weights(bd, bd[w_key])
        # Reflected (entire-domain only): domain-wide arrays including the
        # surface bypass (Lambertian-diffuse -- no spike, no cloud-only needed).
        if _args.entire_domain:
            if 'reflected_counts_domain_wide' in mh:
                mh['reflected_counts'] = mh['reflected_counts_domain_wide']
            if 'reflected_weights_domain_wide' in bd:
                bd['reflected_bdf'] = _bdf_from_weights(bd, bd['reflected_weights_domain_wide'])

# --brf (schema >= 1.3): swap rows 3-4 to the rigorous BRF/BTF grids the app
# panels display. Applied AFTER the cloud-only swap above -- for Uniform-domain
# exports the BRF/BTF grids are already built from the cloud-only weights, so
# this override is the final word for the radiance rows (the mu row keeps
# whatever --transmitted-cloud-only selected). Not meaningful for the
# N-normalized entire-domain view.
USE_BRF = _args.brf and not _args.entire_domain
if _args.brf and _args.entire_domain:
    print('WARNING: --brf ignored with --entire-domain (domain-mean view is N-normalized by design).')
if USE_BRF:
    for exp, tag in ((A, 'A'), (B, 'B')):
        bd = exp.raw['bdf']
        if 'reflected_brf' in bd and 'net_transmitted_brf' in bd:
            bd['reflected_bdf'] = bd['reflected_brf']
            bd['net_transmitted_bdf'] = bd['net_transmitted_brf']
        else:
            print(f'WARNING: file {tag} has no BRF grids (schema < 1.3?); plotting its N-normalized BDF.')
QTY_R = 'BRF' if USE_BRF else 'BDF'
QTY_T = 'BTF' if USE_BRF else 'BDF'

def frac(c):
    c = np.maximum(0, np.asarray(c, float)); s = c.sum()
    return c / s if s > 0 else c
def mean_mu(exp, key):
    c = np.maximum(0, np.asarray(getattr(exp, key), float)); ctr = exp.mu_bin_centers
    return (c * ctr).sum() / c.sum() if c.sum() > 0 else np.nan
def bar_pair(ax, vA, vB):
    x = np.arange(len(vA))
    ax.bar(x, vA, width=0.92, color=COLOR_A, alpha=ALPHA, edgecolor=COLOR_A, linewidth=0.4)
    ax.bar(x, vB, width=0.92, color=COLOR_B, alpha=ALPHA, edgecolor=COLOR_B, linewidth=0.4)

fig = plt.figure(figsize=(13, 17))
gs = fig.add_gridspec(4, 4, height_ratios=[1, 1, 1, 1.25], hspace=0.42, wspace=0.45)

# ---------- Row 1: mu histograms ----------
nmu = A.raw['mu_histograms']['n_bins']
for ci, (key, ttl) in enumerate([('mu_reflected','Reflected'),
                                  ('mu_net_transmitted','Net transmitted (surface-deposited)')]):
    a = fig.add_subplot(gs[0, 2*ci:2*ci+2])
    bar_pair(a, frac(getattr(A, key)), frac(getattr(B, key)))
    for exp, col_ in [(A, COLOR_A), (B, COLOR_B)]:
        a.axvline((1 - mean_mu(exp, key)) * nmu - 0.5, color=col_, ls='--', lw=1.2, alpha=0.9)
    a.set_title(ttl, fontsize=12); a.set_xlabel('|μ| = |cos Θ|')
    # Area-normalized by construction (each run divided by its own total), so
    # this row compares SHAPE only — absolute differences between the runs
    # (e.g. the total-R deficit from side leakage) appear in the BDF rows
    # below, which are absolute per launched photon.
    a.set_ylabel('fraction of photons / bin  (flux)\n(area-normalized: shape only)')
    a.set_xticks([-0.5, nmu/2-0.5, nmu-0.5]); a.set_xticklabels(['1','0.5','0'])
    a.set_xlim(-0.8, nmu-0.2); a.grid(axis='y', alpha=0.25)

# ---------- Row 2: path-length ----------
PHa, PHb = A.raw['path_length_histograms'], B.raw['path_length_histograms']
npath, bmax = PHa['n_bins'], PHa['bin_max']
if PHb['bin_max'] != bmax:
    print(f'WARNING: path bin_max differs ({bmax} vs {PHb["bin_max"]}); bars use {LABEL_A} scale.')
for ci, (key, ttl) in enumerate([('reflected','Reflected'),
                                  ('net_transmitted','Net transmitted (surface-deposited)')]):
    a = fig.add_subplot(gs[1, 2*ci:2*ci+2])
    bar_pair(a, frac(PHa[f'{key}_counts']), frac(PHb[f'{key}_counts']))
    a.axvline(PHa[f'{key}_mean']/bmax*npath-0.5, color=COLOR_A, ls='--', lw=1.2, alpha=0.9)
    a.axvline(PHb[f'{key}_mean']/bmax*npath-0.5, color=COLOR_B, ls='--', lw=1.2, alpha=0.9)
    a.set_title(ttl, fontsize=12); a.set_xlabel('optical path length')
    # Area-normalized by construction (each run divided by its own total), so
    # this row compares SHAPE only — absolute differences between the runs
    # (e.g. the total-R deficit from side leakage) appear in the BDF rows
    # below, which are absolute per launched photon.
    a.set_ylabel('fraction of photons / bin  (flux)\n(area-normalized: shape only)')
    a.set_xticks([-0.5, npath/2-0.5, npath-0.5]); a.set_xticklabels(['0', f'{bmax/2:.0f}', f'>{bmax:.0f}'])
    a.set_xlim(-0.8, npath-0.2); a.grid(axis='y', alpha=0.25)

# ---------- Row 3: BDF vs zenith (absolute, phi-avg) ----------
def bdf_az(exp, which):
    g = exp.reflected_bdf if which == 'refl' else exp.net_transmitted_bdf
    return exp.theta_centers_deg, np.nanmean(np.maximum(0, g), axis=1)
for ci, (which, ttl) in enumerate([('refl','Reflected'),('net','Net transmitted (surface-deposited)')]):
    a = fig.add_subplot(gs[2, 2*ci:2*ci+2])
    th, gA = bdf_az(A, which); _, gB = bdf_az(B, which)
    a.bar(th, gA, width=4.2, color=COLOR_A, alpha=ALPHA, edgecolor=COLOR_A, linewidth=0.4)
    a.bar(th, gB, width=4.2, color=COLOR_B, alpha=ALPHA, edgecolor=COLOR_B, linewidth=0.4)
    a.set_title(ttl, fontsize=12); a.set_xlabel('exit zenith Θ (deg)')
    # BDF = (W/N)·π/(μΔμΔφ) is DIMENSIONLESS (a reflectance-factor-type
    # quantity, π·L/F₀) — proportional to radiance, not radiance itself, so
    # it must not be tagged as a unit (README: "a quantity proportional to
    # radiance"). The 1/μ factor is why this row rises toward grazing Θ while
    # the flux rows above fall: e.g. a last ring holding ~0.1% of the photons
    # has μ̄≈0.022, amplifying its BDF ~46×. Rows 1-3 are mutually consistent
    # to machine epsilon via (1/N)·dN/dμ = 2μ·B̄DF (verified 2026-07-14).
    a.set_ylabel(f'{QTY_R if ci == 0 else QTY_T} (φ-avg, absolute)\n(dimensionless, ∝ radiance)')
    a.set_xticks([0,30,60,90]); a.set_xlim(-3, 93); a.grid(axis='y', alpha=0.25)

# ---------- Row 4: BDF polar heatmaps (radiance) ----------
# Build polar bin edges shared by all runs (fixed export grid).
phi_c = np.asarray(A.raw['bdf']['phi_centers_deg'], float)         # 0,5,...,355
th_c  = np.asarray(A.raw['bdf']['theta_centers_deg'], float)       # ~0,5,...,90
dphi = 360.0 / len(phi_c)
phi_edges = np.radians(np.concatenate([phi_c - dphi/2, [phi_c[-1] + dphi/2]]))
th_edges = np.empty(len(th_c)+1)
th_edges[1:-1] = 0.5*(th_c[:-1]+th_c[1:]); th_edges[0]=0.0; th_edges[-1]=90.0

def polar_grid(exp, which):
    g = exp.reflected_bdf if which=='refl' else exp.net_transmitted_bdf
    g = np.array(g, float); g[g <= 0] = np.nan          # blank zero/negative bins (browser style)
    return g

def draw_polar(ax, exp, which, title, vmax):
    ax.set_facecolor('black')
    C = polar_grid(exp, which)
    pcm = ax.pcolormesh(phi_edges, th_edges, C, cmap=POLAR_CMAP, vmin=0, vmax=vmax, shading='flat')

    ax.set_theta_zero_location('N')
    ax.set_theta_direction(-1)
    ax.set_rmax(90)

    # Radial grid labels: 30, 60, 90
    _, rlabels = ax.set_rgrids([30, 60, 90], labels=['30', '60', '90'], angle=135)
    for lab in rlabels:
        lab.set_fontsize(7)
        lab.set_color('0.4')
        lab.set_transform(
        	lab.get_transform() + ScaledTranslation(6 / 72, -2 / 72, ax.figure.dpi_scale_trans)
        	)
        	
    # Angular grid labels: 0, 90, 180, 270
    ax.set_thetagrids([0, 90, 180, 270], labels=['0°', '', '180°', ''])
    ax.tick_params(axis='x', pad=-2)

    ax.tick_params(colors='0.4', labelsize=7)
    ax.set_title(title, fontsize=8.5, pad=5)
    return pcm
    
# per-channel shared color scale. Use a PERCENTILE (not the raw max) so a few
# hot bins (e.g. the bright transmitted nadir core) don't compress the range;
# BDF above vmax is clipped to the top color (colorbar 'extend' arrow shows it).
def vmax_pct(which, p=POLAR_PCTILE):
    vals = np.concatenate([polar_grid(A, which).ravel(), polar_grid(B, which).ravel()])
    vals = vals[np.isfinite(vals)]
    return float(np.percentile(vals, p)) if vals.size else 1.0
vmax_refl = vmax_pct('refl')
vmax_net  = vmax_pct('net')
# Dedicated colorbar columns (thin) so the four polar axes keep an IDENTICAL
# size — fig.colorbar(ax=[...]) would steal space from the polar axes unevenly.
# Polar maps in fixed-width columns (ratio 1, so all four stay identical in
# size); each colorbar is a THIN column followed by a wider SPACER column, so
# the small colorbar label cannot spill onto the adjacent polar plot.
sub = gs[3, :].subgridspec(1, 8, width_ratios=[1, 1, 0.08, 0.31, 1, 1, 0.08, 0.31], wspace=0.18)
ax_cr = fig.add_subplot(sub[0, 0], projection='polar')
ax_ur = fig.add_subplot(sub[0, 1], projection='polar')
cax_r = fig.add_subplot(sub[0, 2])
ax_cn = fig.add_subplot(sub[0, 4], projection='polar')
ax_un = fig.add_subplot(sub[0, 5], projection='polar')
cax_n = fig.add_subplot(sub[0, 6])
# Short run tags for polar titles: first word alone is ambiguous when both
# labels share it (e.g. "uniform top" vs "uniform domain M=4"), so use up to
# the first two words.
sa = ' '.join(LABEL_A.split()[:2]); sb = ' '.join(LABEL_B.split()[:2])
draw_polar(ax_cr, A, 'refl', f'{sa}\nReflected',       vmax_refl)
draw_polar(ax_ur, B, 'refl', f'{sb}\nReflected',       vmax_refl)
draw_polar(ax_cn, A, 'net',  f'{sa}\nNet transmitted', vmax_net)
draw_polar(ax_un, B, 'net',  f'{sb}\nNet transmitted', vmax_net)
for cax, vmax, lab in [(cax_r, vmax_refl, f'{QTY_R} (reflected)'), (cax_n, vmax_net, f'{QTY_T} (net transmitted)')]:
    cb = fig.colorbar(ScalarMappable(Normalize(0, vmax), POLAR_CMAP), cax=cax, extend='max')
    cb.set_label(lab, fontsize=7)        # smaller label
    cb.ax.tick_params(labelsize=6)       # smaller tick numbers
CBAR_HEIGHT_SCALE = 0.75   # try 0.6-0.9; smaller = shorter colorbars

for cax in [cax_r, cax_n]:
    p = cax.get_position()
    new_h = p.height * CBAR_HEIGHT_SCALE
    cax.set_position([
        p.x0,
        p.y0 + (p.height - new_h) / 2,
        p.width,
        new_h,
    ])

# Shift the polar maps left (centered more than uniform) to open intra-pair
# spacing so the azimuth labels (90 deg / 270 deg) of adjacent maps don't
# overlap, and to pull the uniform maps off their colorbars. Tune as needed.
DX_CENTERED, DX_UNIFORM = 0.030, 0.010   # figure-fraction shifts
POLAR_SCALE = 1.0   # try 0.75-0.90; smaller = more whitespace

for axp, dx in [(ax_cr, DX_CENTERED), (ax_ur, DX_UNIFORM),
                (ax_cn, DX_CENTERED), (ax_un, DX_UNIFORM)]:
    p = axp.get_position()

    new_w = p.width * POLAR_SCALE
    new_h = p.height * POLAR_SCALE

    axp.set_position([
        p.x0 - dx + (p.width - new_w) / 2,
        p.y0 + (p.height - new_h) / 2,
        new_w,
        new_h,
    ])

handles = [Patch(facecolor=COLOR_A, alpha=ALPHA, label=LABEL_A),
           Patch(facecolor=COLOR_B, alpha=ALPHA, label=LABEL_B),
           plt.Line2D([0],[0], color='k', ls='--', lw=1.2, label='mean (μ / path rows)')]
fig.legend(handles=handles, loc='upper center', ncol=3, frameon=False, bbox_to_anchor=(0.5, 0.965), fontsize=10)
fig.suptitle(SUPTITLE, fontsize=12, y=0.995)
fig.savefig(OUTFILE, dpi=150, facecolor='white', bbox_inches='tight')
print(f'wrote {OUTFILE}')
