# Avatars de métiers — collection pixel art de face

Générés avec l’outil imagegen intégré, le 15 octobre 2026. Aucun appel au CLI de génération. Le mage architecte de face a été explicitement validé par l’utilisateur et sert de référence commune. Les dix-neuf autres personnages ont des silhouettes et métiers distincts.

Chaque fichier `<id>.png` est une planche de 1536 × 1024 pixels (3 colonnes, 2 lignes) : repos ; travail A ; travail B ; travail C ; travail D ; réussite. `software-architect-idle.png` conserve le portrait de repos exactement validé. L’export mécanique `npm run avatars:pack` crée des PNG de 256 × 256 et un GIF transparent de quatre images (320 ms par image, boucle infinie). La préférence de réduction des mouvements affiche le repos pendant le travail.

Les aplats colorés présents dans les canaux RGB hors des sprites sont invisibles grâce au canal alpha. Le GIF utilise un index transparent et réinitialise chaque image pour éviter les traînées. Les PNG normalisent uniquement le bruit d’arrondi alpha de 0 ou 1/255 vers zéro, sans redessiner les pixels visibles. Aucun fond n’est ajouté aux images exportées.

## Prompt commun des planches

```text
Use case: stylized-concept. Create a production SPRITE SHEET for ONE Feature Studio character, NOT different characters.
Reference image is the APPROVED front-view wizard. Match its authentic chunky retro pixel-art technique, visible square pixels, stepped edges, dark pixel outlines, vivid limited colors and compact waist-up framing. STYLE/CAMERA ONLY for new characters, do not copy the wizard's face/hat/beard/glasses.
LAYOUT IS MANDATORY: landscape canvas exactly 1536x1024 pixels, 3 equal columns x 2 equal rows. SIX isolated sprites, each inside its own 512x512 cell, NO visible grid lines or cell backgrounds. Each cell has 40px transparent inner padding. Same character identity, outfit, prop designs, scale, baseline and front-facing camera in all six cells. Full compact waist-up sprite plus very shallow horizontal wood ledge, no chair or feet.
Cell order left-to-right, top-to-bottom:
1 (top-left): IDLE, calm ready pose, occupational tools resting.
2 (top-middle): WORKING FRAME A, ready to perform job gesture.
3 (top-right): WORKING FRAME B, hands partway into gesture.
4 (bottom-left): WORKING FRAME C, hands actively doing gesture.
5 (bottom-middle): WORKING FRAME D, hands returning toward A for a smooth loop.
6 (bottom-right): SUCCESS, joyful clearly different expression and an unmistakable thumbs-up or raised celebratory hand; finished work has a clear green checkmark.
Animate the job gesture using the four working frames. Keep head, torso, ledge and props anchored identically between work frames; only hands/tools/eyes change a few native sprite pixels. No camera motion, resizing, changing costume or disappearing equipment.
Authentic hand-crafted 16-bit/32-bit game sprite, approximately 128x128 logical pixel grid per character then enlarged by nearest neighbor. Only 3-4 stepped shades per material. NO smooth gradients, painterly texture, anti-aliased curves, 3D, realistic rendering or high-resolution anime finish.
FRONT VIEW in EVERY cell: face, shoulders and torso directly toward viewer, both eyes visible, no side or three-quarter angle.
TRUE TRANSPARENT ALPHA everywhere outside each sprite, including space between all six cells; no background, wall, floor, ground shadow, panel, halo or drawn checkerboard. No labels, numbers, letters, text, logos, watermark, sparkles or extra characters.
MOST IMPORTANT: a distinctive archetype, head shape, silhouette and outfit, clearly different from the wizard and other office workers. Obey exact face/hair/hat/glasses requirements below.
Character and work gesture:
```

## Personnages et gestes

### backend-developer — Développeur backend

```text
The HOODIE CODER: a young man with shaggy dark hair, a dark green hooded sweatshirt and large orange headphones around his neck, mischievous friendly eyes, NO glasses and NO beard. Slim triangular silhouette. Hands typing behind a small graphite laptop, its back bearing only a simple cyan API-node glyph. A chunky coffee mug with steam pixels on the narrow ledge. Recognizably a backend developer.
Working animation: Types on keyboard; fingers change position and eyes alternate looking down/forward.
```

### frontend-developer — Développeuse frontend

```text
The POP FRONTEND CODER: a cheerful young woman with vivid coral-red hair in two short outward ponytails, square yellow hair clips, bright cyan headphones, plum zip jacket over a cream shirt, NO glasses. Distinct wide headphone-and-ponytail silhouette. Holds a smartphone with colorful website panels upright and gestures toward a tiny laptop displaying the same responsive layout. No painter's beret.
Working animation: Tests a responsive layout: taps smartphone with index finger, small page panels change position.
```

### qa-tester — Testeur

```text
The BUG DETECTIVE: a middle-aged round-faced detective in a tan deerstalker cap and oversized beige trench coat, thick dark eyebrows, a small dark moustache, NO glasses. Wide collar silhouette. One eye comically enlarged by a round magnifying glass held in front of it, the other looks at the viewer. Holds a clipboard with green checkmarks and a single large red bug symbol. Small laptop at bottom edge. A quality tester searching for bugs.
Working animation: Moves magnifying glass across bug checklist, then ticks a box.
```

### qa-automation — Automaticien QA

```text
The TEST ROBOT: a friendly squat ivory-and-orange robot, NOT a human. Large square cyan screen face with two expressive rectangular pixel eyes, small orange antenna, round ear modules, compact mechanical arms. One mechanical hand taps a phone mounted on a small test stand, another presses a large green test button. Three green checkmarks on a tiny dark console. Distinct square-headed robotic silhouette.
Working animation: Mechanical finger presses phone screen and another hand operates test button; robot eyes blink.
```

### technical-writer — Rédactrice technique

```text
The TECHNICAL SCRIBE: an older woman with deep brown skin, silver hair in an enormous high bun, small crescent reading spectacles on the tip of her nose, a warm burgundy shawl over cream clothing and a turquoise brooch. Tall bun and draping shawl silhouette. Writing with a large feather quill in an open technical manual with a tiny node diagram and abstract lines, two thick books and inkwell on narrow ledge. Wise warm expression.
Working animation: Quill nib moves across the manual; left hand steadies page.
```

### infrastructure-engineer — Ingénieur infrastructure

```text
The INFRA MECHANIC: a broad stocky man with a big brown handlebar moustache, orange hardhat, royal-blue work overalls with rolled sleeves and cream undershirt, no glasses. Wide square shoulders. Holds a big steel wrench in one hand and a loop of blue Ethernet cable in the other, a compact server appliance with three green status lights sits on the narrow bottom ledge. Friendly rugged face.
Working animation: Tightens server connector using wrench, slight wrist rotation while other hand holds cable.
```

### devops-engineer — Ingénieure DevOps

```text
The DEPLOYMENT AVIATOR: a confident woman with dark brown skin, leather aviator cap with large brass goggles pushed above the forehead, short cream flying scarf and brown pilot jacket. NO glasses on eyes. Hands at a tiny deployment control console showing three connected stages ending in a green checkmark, a chunky release lever and small package cube. Pilot who coordinates software delivery, distinct aviator silhouette, no aircraft or background.
Working animation: Operates deployment lever through successive stages; tiny console status changes.
```

### sre-engineer — Ingénieur SRE

```text
The RELIABILITY FIREFIGHTER: an alert adult man with fair skin, short blond hair, a bright RED firefighter helmet with broad brim, red emergency jacket with ivory reflective stripes and a shoulder radio. Clean-shaven, no spectacles. Holding a compact monitoring tablet with a cyan heartbeat line and green service dots, other hand holding a small flashlight angled downward. No flames. Different silhouette from the orange-hardhat mechanic.
Working animation: Checks monitoring tablet while tapping controls; eyes blink and graph changes subtly.
```

### security-engineer — Ingénieure sécurité

```text
The SECURITY NINJA: a compact stealthy female ninja in a charcoal hood and dark violet wrapped outfit, lower face covered, expressive green eyes visible through a narrow opening. No spectacles. Distinct pointed shoulder wraps and short headband tails. One hand presents a brass padlock, the other holds a cyan hardware security key. Small shield-emblem laptop at bottom. Friendly focused eyes, no weapons.
Working animation: Plugs security key into laptop then checks padlock, small careful wrist motion.
```

### data-engineer — Data engineer

```text
The DATA CONDUCTOR: a cheerful adult man with medium brown skin, a tall teal locomotive-conductor cap, short sandy moustache, mustard shirt with teal suspenders, no glasses. Long cap and narrow upright silhouette. Arranging chunky cyan database cylinders and orange data blocks on a tiny conveyor-like pipeline console, clear arrows joining blocks on a small front-facing panel. No locomotive or scene, only compact occupational props on bottom ledge.
Working animation: Transfers one data block along the small pipeline conveyor into database stack.
```

### data-scientist — Data scientist

```text
The MAD DATA SCIENTIST: an energetic young woman with wild pale-lavender hair flaring out to both sides, oversized cyan laboratory goggles resting on top of her head, white lab coat over lime-green shirt. No glasses on eyes. Holds a flask with bright green liquid in one hand and a small tablet displaying colored scatter-plot dots in the other. Tiny open graph notebook on ledge. Exuberant star-shaped hair silhouette, matching old scientist sprite charm.
Working animation: Swirls flask gently while recording a few chart dots on tablet.
```

### database-administrator — Administrateur BDD

```text
The DATABASE DWARF: a cheerful stocky fantasy dwarf with enormous square rust-red beard in two braids, thick brows, small bald crown and a dark green knit cap, leather vest over slate shirt. No glasses. Very broad low rounded silhouette. Protectively holding a stack of three silver database cylinders, brass backup key hanging from belt, a small dark backup drive on the ledge. Big reliable hands, warm smile. No weapons.
Working animation: Checks cylinder stack and rotates small backup key; hands move slightly.
```

### cloud-architect — Architecte cloud

```text
The CLOUD ASTRONAUT: an adult woman with warm brown skin and short black hair visible inside a large round clear bubble helmet, white and sky-blue spacesuit, orange wrist controls. No glasses. Very distinctive circular helmet silhouette. Holding a tablet showing a white cloud connected to three blue server blocks, small cloud-shaped badge on suit, one hand pointing at the topology. No space background, stars or floating props.
Working animation: Points to successive server blocks on cloud tablet with a gloved finger.
```

### ux-designer — Designer UX/UI

```text
The UX ARTIST: a stylish androgynous adult with warm olive skin, short asymmetrical purple hair, oversized forest-green painter beret tilted to one side, coral scarf and dark cream-splattered artist apron. No glasses. One hand holds a chunky stylus, the other a drawing tablet with three simple mobile wireframes; fan of colored swatches on ledge. Expressive thoughtful face, distinctive broad beret and diagonal fringe silhouette.
Working animation: Moves stylus over wireframe tablet, wrist and eyes change gently.
```

### product-owner — Product owner

```text
The PRODUCT CAPTAIN: a confident woman with dark brown skin and long thick silver braid over shoulder, navy captain's tricorn hat with plain brass round badge, navy coat with gold shoulder trim, cream cravat. No glasses. Distinct wide tricorn silhouette, calm smile. Holding a compact product roadmap scroll with three horizontal colored bars and a small board with colored blank task cards. No ship or weapon.
Working animation: Moves a task card across roadmap board, then steadies it.
```

### business-analyst — Analyste métier

```text
The BUSINESS STRATEGIST: a slim elderly man with light olive skin, receding grey hair and exaggerated tall upright forelock, thin rectangular dark spectacles, dark plum waistcoat over cream rolled-sleeve shirt and amber bow tie. Clean-shaven long narrow face. Holding a printed process flow chart of connected rounded blocks and a pencil, small bronze balance scale on ledge to suggest weighing requirements. No wizard hat or beard.
Working animation: Traces process-flow steps with pencil and checks them.
```

### code-reviewer — Relectrice de code

```text
The CODE INSPECTOR: an adult woman with pale skin, straight jet-black angular bob and a single vivid white streak, narrow red rectangular spectacles, black high-collar jacket with crimson lining. Strong sharp angular silhouette, focused expression. Holds an open laptop angled frontward showing two panels of chunky green and red diff bars, other hand holding a big green approval stamp. No actual text. Distinct from the masked security ninja.
Working animation: Inspects diff and lowers green stamp onto small checklist, then lifts it.
```

### support-engineer — Technicien support

```text
The SUPPORT HELPER: a friendly young man with warm tan skin, large curly brown hair forming a round fluffy silhouette, turquoise baseball cap worn backwards, chunky purple headset with microphone, yellow polo shirt. NO glasses or beard. Holding a small white help-ticket card with a cyan speech bubble icon, other hand giving a thumbs-up beside a tiny keyboard. Welcoming large smile, reassuring eyes.
Working animation: Types a reply and adjusts headset microphone, small hand/eye movement.
```

### release-manager — Responsable des livraisons

```text
The RELEASE DISPATCHER: a cheerful older woman with fair skin, short white pixie hair sticking out from a bright brick-red peaked courier cap, red utility vest with cream pockets and dark shirt. No glasses. Compact squared cap-and-vest silhouette. Cradles a small sealed cardboard software-release package with a large green checkmark, other hand holds a small checklist board with three green ticks; tiny rocket-shaped desk ornament. No text or logos.
Working animation: Checks clipboard then seals the parcel using a tape tool, small anchored hand motion.
```

## Portrait de repos validé

```text
Use case: style-transfer.
Create ONE corrected approval preview: the SOFTWARE ARCHITECT WIZARD avatar for Feature Studio.
Image 1 is the newest pixel-art wizard preview: preserve its coarse visible square pixels, indigo/violet hat and robe, brass details, white beard, cyan software blueprint and compact character-only composition.
Image 2 is the ORIGINAL old wizard avatar: use its STRAIGHT-ON FRONT VIEW and compact face-forward layout as the camera reference. The user explicitly changed the requirement to FRONT VIEW, so completely remove the three-quarter angle.
The wizard's face, torso and shoulders must face directly toward the viewer, eyes looking straight ahead, both ears/cheeks equally visible, shoulders level and equally sized. No head turned sideways, no diagonal torso, no isometric perspective. The tiny wood ledge at the bottom is straight and horizontal viewed head-on, with no visible receding side edge.
A charming old wizard with an angular floppy purple pointed hat and gold moon, bushy silver eyebrows, tiny round amber glasses, broad white moustache and beard, indigo robe with brass clasp. Both hands visible: one holds a brass drafting compass, one steadies an unfolded cyan software blueprint containing a few simple connected service blocks. The blueprint faces the viewer, near frontal with only a small natural curl. Two stacked books on the bottom left. Crop at the waist behind a very shallow narrow wooden ledge like the OLD avatar; no chair, feet or full desk.
Authentic hand-crafted retro 16-bit/32-bit game sprite with deliberately chunky square pixel clusters and clear stair-step contours, as if a roughly 160x160 sprite enlarged by nearest neighbor. Flat pixel planes with only 3-4 shades per material. Crisp dark 1-native-pixel outlines. Do not make a smooth high resolution cartoon, painterly illustration, 3D figure, softly shaded render, or anime portrait. No anti-aliased curves, blur or soft gradients.
Square composition with about 8% clear transparent margin on every side, all hat tips, arms, books and scroll fully inside frame. TRUE TRANSPARENT ALPHA outside the sprite. No background, floor, wall, cast ground shadow, colored panel, halo, drawn checkerboard, text, letters, logos, watermark, sparkles, other characters, collage or sprite sheet.
Only this single revised front-view preview; the rest of the collection waits for user approval.
```


## Architecte logiciel — poses supplémentaires

La même mise en page et les mêmes contraintes s’appliquent, en remplaçant les consignes de création d’une nouvelle identité par la conservation exacte du mage validé.

```text
undefined
Working animation: Move the drafting compass over the blueprint in four small steps.
```
