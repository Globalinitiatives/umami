-- CreateTable
CREATE TABLE "session_replay_shared" (
    "shared_replay_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "note" VARCHAR(500),
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "session_replay_shared_pkey" PRIMARY KEY ("shared_replay_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_replay_shared_shared_replay_id_key" ON "session_replay_shared"("shared_replay_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_replay_shared_slug_key" ON "session_replay_shared"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "session_replay_shared_website_id_visit_id_key" ON "session_replay_shared"("website_id", "visit_id");

-- CreateIndex
CREATE INDEX "session_replay_shared_website_id_idx" ON "session_replay_shared"("website_id");

-- CreateIndex
CREATE INDEX "session_replay_shared_visit_id_idx" ON "session_replay_shared"("visit_id");

-- CreateIndex
CREATE INDEX "session_replay_shared_website_id_created_at_idx" ON "session_replay_shared"("website_id", "created_at");

-- AddForeignKey
ALTER TABLE "session_replay_shared" ADD CONSTRAINT "session_replay_shared_website_id_fkey" FOREIGN KEY ("website_id") REFERENCES "website"("id") ON DELETE CASCADE ON UPDATE CASCADE;
