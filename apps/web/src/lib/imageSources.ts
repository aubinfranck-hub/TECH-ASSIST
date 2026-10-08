/**
 * High-resolution remote photography used by the public website.
 * The previous local JPGs were only ~340px wide and became visibly soft on
 * retina/desktop layouts. These sources are served by Pexels at a requested
 * width so the browser does not upscale tiny assets.
 */
const pexels = (id: string) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1800&q=88`;

export const SITE_IMAGES = {
  hero: pexels('5717304'),
  office: pexels('10375901'),
  pc: pexels('6754846'),
  network: pexels('37605911'),
  security: pexels('5483240'),
} as const;
