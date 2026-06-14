#!/usr/bin/env python3
"""
plot_mc_comparison.py — 4x2 comparison figure for two mc_cloud_rt_v4 JSON exports.

Rows:
  (1) exit-angle |mu| histogram          (flux/energy: fraction of photons per bin)
  (2) optical path-length distribution   (flux/energy: fraction of photons per bin)
  (3) BDF vs exit zenith, phi-averaged    (radiance, absolute)
  (4) BDF polar heatmap                    (radiance; zenith=radius, azimuth=angle),
                                           shown for BOTH runs per channel,
                                           matching the browser BDF panel style.
Columns (rows 1-3): (left) Reflected, (right) Net transmitted (surface-deposited).

NOTE on units: rows 1-2 are FLUX (photon-count) distributions; rows 3-4 are
RADIANCE. The two are consistent but not identical representations of the same
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

A = MCExport.load(FILE_A); B = MCExport.load(FILE_B)

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
    a.set_ylabel('fraction of photons / bin  (flux)')
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
    a.set_ylabel('fraction of photons / bin  (flux)')
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
    a.set_ylabel('BDF (φ-avg, absolute)  (radiance)')
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
sa, sb = LABEL_A.split()[0], LABEL_B.split()[0]   # short run tags for polar titles
draw_polar(ax_cr, A, 'refl', f'{sa}\nReflected',       vmax_refl)
draw_polar(ax_ur, B, 'refl', f'{sb}\nReflected',       vmax_refl)
draw_polar(ax_cn, A, 'net',  f'{sa}\nNet transmitted', vmax_net)
draw_polar(ax_un, B, 'net',  f'{sb}\nNet transmitted', vmax_net)
for cax, vmax, lab in [(cax_r, vmax_refl, 'BDF (reflected)'), (cax_n, vmax_net, 'BDF (net transmitted)')]:
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
