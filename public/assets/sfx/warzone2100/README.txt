Warzone 2100 sound effects — provenance and license
=========================================================

The 16 .ogg files in this directory are UNMODIFIED audio assets from the
open-source game Warzone 2100 (https://wz2100.net/), copied verbatim:

  air-strike-1.ogg          <- jet_on_attackroute_close_to_target_or_attacking.ogg
  air-unit-launch-1.ogg     <- jet_on_the_way.ogg
  air-unit-launch-3.ogg     <- jet_returning_to_base.ogg
  machine-gun-strike-1.ogg  <- short_machine_gun_fire_1.ogg
  machine-gun-strike-2.ogg  <- short_machine_gun_fire_2.ogg
  machine-gun-strike-3.ogg  <- short_machine_gun_fire_3.ogg
  sdi-intercept-1.ogg       <- interceptors_launched.ogg (SDI interception
                              scramble: one file, one purpose)
  missile-launch-1.ogg      <- missel_launched.ogg
  naval-strike-1.ogg        <- warship_distroyer_shooting.ogg
  nuclear-strike-1.ogg      <- greate_explosion.ogg
  production-complete-1.ogg <- power_spark_power_plant.ogg
  sabotage-success-1.ogg    <- power_down.ogg
  submarine-selected-1.ogg  <- submarine_unit_selected_1.ogg
  submarine-selected-2.ogg  <- submarine_unit_selected_2.ogg
  ui-select-1.ogg           <- walki_talki.ogg
  unit-selected-1.ogg       <- reporting.ogg

Only the file NAMES were changed (kebab-case, per the cue they serve —
see doc/SOUND_EFFECTS.adoc). The audio data is bit-for-bit identical to the
Warzone 2100 originals.

The three machine-gun files were renamed once more, from `unit-strike-*.ogg`
to `machine-gun-strike-*.ogg`. They already served only the cue that fires
for Mech. Inf., but the cue was renamed `unitStrike` → `machineGunStrike`
when the generic land blow moved to the synthesized `impactStrike`, and a
file is named after the cue it serves. The Warzone originals are unchanged.

These assets are licensed under the GNU General Public License, version 2
(GPLv2), the license Warzone 2100 ships under. The full license text is in
LICENSE.txt in this directory. They are included here by MERE AGGREGATION:
they remain GPLv2 works on their own, and their inclusion does not extend
the GPL to this project's source code or any other asset.

If you modify (remix, filter, re-cut) any of these files, the modified file
remains GPLv2 — see LICENSE-THIRD-PARTY.txt in the repository root.
