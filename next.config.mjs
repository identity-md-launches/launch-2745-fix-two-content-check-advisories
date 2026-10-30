/** @type {import('next').NextConfig} */
const config = {
  output: "export", // static site for IPFS (IMD hosting under *.eth.limo)
  trailingSlash: true,
  images: { unoptimized: true },
};
export default config;
