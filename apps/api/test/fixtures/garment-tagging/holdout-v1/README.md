# Wardrobe tagging holdout v1

The manifest freezes 20 synthetic flat-lay catalog images across all six garment
categories and all 14 named subtypes. The two dresses have no subtype in the
wardrobe taxonomy and contribute to category accuracy. The other 18 images
contribute to both measures. Each label was assigned by visual inspection before
FashionCLIP scored the set. The gate runs the pinned production worker and scorer.

The images were created with built-in ImageGen in November 2026, after the pinned
FashionCLIP snapshot. They contain no people, real member photos, logos, or EXIF.
This is a controlled benchmark for isolated garments on simple backgrounds. It
does not estimate accuracy on closet photos with clutter, occlusion, or poor
lighting. Keep these bytes, labels, and cases fixed while tuning the scorer.

## Image generation

Four landscape contact sheets used a 3-column by 2-row grid of top-down product
photographs. Each tile isolates one garment, fully unfolded, or a pair of boots
shown from the side. The request used varied cream, gray, white, and muted pastel
surfaces, soft ambient light, visible seams and texture, and tile edges that keep
the images separate. It excluded people, mannequins, hangers, lettering, logos,
props, and watermarks. The cells were cropped and resized to 384 px square JPEGs.

| Sheet | Subjects, in row order                                                                                                                                        |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A     | Ivory silk camisole, navy ribbed tank, orange short-sleeve crop top, red fitted mini skirt, green pleated midi skirt, and a flowing blue maxi skirt.          |
| B     | Black full-length leggings, navy single-breasted blazer, black asymmetric-zip moto jacket, purple floral dress, yellow sleeveless dress, and red ankle boots. |
| C     | Brown knee-high riding boots, black harness moto boots, plum footed tights, striped teal crew socks, gray lace camisole, and a cream short-sleeve crop top.   |
| D     | Only the navy double-breasted blazer and burgundy ribbed crew socks were selected, before scoring, as the second blazer and second pair of socks.             |
