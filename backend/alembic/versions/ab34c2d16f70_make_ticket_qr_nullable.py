"""Make ticket QR token nullable until provider confirms an actual ticket."""
from alembic import op
import sqlalchemy as sa

revision = "ab34c2d16f70"
down_revision = "9f20b1d7a40c"
branch_labels = None
depends_on = None

def upgrade() -> None:
    with op.batch_alter_table("ticket_orders") as batch_op:
        batch_op.alter_column("qr_token", existing_type=sa.String(length=80), nullable=True)

def downgrade() -> None:
    # Requests without a provider-issued token cannot be represented safely in the old schema.
    op.execute("UPDATE ticket_orders SET qr_token = 'legacy-unissued-' || id WHERE qr_token IS NULL")
    with op.batch_alter_table("ticket_orders") as batch_op:
        batch_op.alter_column("qr_token", existing_type=sa.String(length=80), nullable=False)
