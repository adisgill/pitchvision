"""``pitchvision`` command line."""

from __future__ import annotations

import typer

from pitchvision.config import get_paths

app = typer.Typer(no_args_is_help=True, add_completion=False)


@app.command()
def ingest(
    source: str = typer.Argument(..., help="statsbomb | wyscout | transfermarkt | footballdata"),
    fetch: bool = typer.Option(False, "--fetch", help="Download (rate-limited, cached)."),
    sample: bool = typer.Option(True, "--sample/--full", help="Phase 0 sample or full pull."),
) -> None:
    """Download a source's raw files into data/raw/<source>/ with a manifest."""
    from pitchvision.ingest.sources import SOURCES

    if source not in SOURCES:
        raise typer.BadParameter(f"unknown source {source!r}; one of {sorted(SOURCES)}")
    if not fetch:
        typer.echo("Nothing to do: pass --fetch to download. (`build` never fetches.)")
        raise typer.Exit()
    root = get_paths().source(source)
    files = SOURCES[source](root, sample=sample)
    total = sum(p.stat().st_size for p in files)
    typer.echo(f"{source}: {len(files)} files, {total / 1e6:.1f} MB in {root}")


@app.command()
def build(
    strict: bool = typer.Option(True, "--strict/--no-strict", help="Fail on QA failures."),
    daily: bool = typer.Option(False, "--daily", help="Only the stages new results change."),
) -> None:
    """Rebuild every table from the raw caches (never fetches)."""
    import logging

    from pitchvision import build as b

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    typer.echo(b.run(strict=strict, daily=daily))


@app.command()
def demo(
    publish: bool = typer.Option(
        False, "--publish", help="Also build the web app and push it to GitHub Pages (network)."
    ),
) -> None:
    """Export the web app's data (app/public/data); optionally build and deploy the site."""
    from pitchvision import demo as d

    typer.echo(d.build())
    if publish:
        typer.echo(f"published data version {d.publish()}")


@app.command()
def ledger() -> None:
    """Append today's forecasts for fixtures not yet kicked off to the append-only ledger
    (ledger/predictions.csv, committed daily). Existing rows are never rewritten."""
    from pitchvision.config import LEDGER
    from pitchvision.db import connect
    from pitchvision.forecast.upcoming import append_ledger

    paths = get_paths()
    with connect(paths, read_only=True) as con:
        n = append_ledger(con, LEDGER)
    typer.echo(f"ledger: {n} new forecasts")


@app.command()
def version() -> None:
    """Print the version."""
    from importlib.metadata import version as v

    typer.echo(v("pitchvision"))
