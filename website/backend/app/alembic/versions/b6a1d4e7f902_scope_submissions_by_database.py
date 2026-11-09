"""scope contributors and uploaded records by database

Revision ID: b6a1d4e7f902
Revises: a4f2d8c9b6e3
"""

from alembic import op
import sqlalchemy as sa


revision = "b6a1d4e7f902"
down_revision = "a4f2d8c9b6e3"
branch_labels = None
depends_on = None


def upgrade():
    # These installations historically held DiazoDB submissions. New writes
    # are tagged by the application's DATABASE_KEY (LanTree in this project).
    for table in ("job", "contributor", "user_database_record"):
        op.add_column(
            table,
            sa.Column(
                "database_key",
                sa.String(length=64),
                nullable=False,
                server_default="DiazoDB",
            ),
        )
        op.create_index(f"ix_{table}_database_key", table, ["database_key"])

    op.drop_constraint("contributor_orcid_key", "contributor", type_="unique")
    op.create_unique_constraint(
        "uq_contributor_database_key_orcid",
        "contributor",
        ["database_key", "orcid"],
    )

    for table in ("job", "contributor", "user_database_record"):
        op.alter_column(table, "database_key", server_default=None)


def downgrade():
    op.drop_constraint(
        "uq_contributor_database_key_orcid", "contributor", type_="unique"
    )
    op.create_unique_constraint("contributor_orcid_key", "contributor", ["orcid"])
    for table in ("user_database_record", "contributor", "job"):
        op.drop_index(f"ix_{table}_database_key", table_name=table)
        op.drop_column(table, "database_key")
