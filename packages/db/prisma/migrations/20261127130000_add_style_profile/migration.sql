CREATE TYPE "StyleMood" AS ENUM ('active', 'chic', 'cozy', 'classic');
CREATE TYPE "StylePalette" AS ENUM ('neutral', 'colorful');
CREATE TYPE "StyleTexture" AS ENUM ('smooth', 'textured');
CREATE TYPE "StyleFit" AS ENUM ('fitted', 'relaxed');

CREATE TABLE "StyleProfile" (
    "user_id" TEXT NOT NULL,
    "mood" "StyleMood",
    "palette" "StylePalette",
    "texture" "StyleTexture",
    "fit" "StyleFit",
    "avoid" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    CONSTRAINT "StyleProfile_pkey" PRIMARY KEY ("user_id"),
    CONSTRAINT "StyleProfile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StyleProfile_avoid_choices_check" CHECK (
        "avoid" <@ ARRAY['crop-top', 'mini-skirt', 'leggings']::TEXT[]
        AND array_position("avoid", NULL) IS NULL
        AND cardinality("avoid") =
            ('crop-top' = ANY("avoid"))::INT +
            ('mini-skirt' = ANY("avoid"))::INT +
            ('leggings' = ANY("avoid"))::INT
    )
);

-- Direct client access is closed. The API derives ownership from verified auth.
REVOKE ALL ON TABLE public."StyleProfile" FROM PUBLIC, anon, authenticated;
ALTER TABLE public."StyleProfile" ENABLE ROW LEVEL SECURITY;
