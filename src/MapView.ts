import { PerspectiveCamera, Scene, WebGLRenderer, Vector3, Group, Camera, Vector2, Object3D } from 'three';
import {generateRandomMap} from "./map-generator"
import MapMesh from "./MapMesh"
import { TextureAtlas, TileData, TileDataSource } from './interfaces';
import {loadFile} from "./util"
import { screenToWorld } from './camera-utils';
import Grid from './Grid';
import DefaultTileSelector from "./DefaultTileSelector"
import DefaultMapViewController from "./DefaultMapViewController"
import MapViewController from './MapViewController';
import { MapViewControls } from './MapViewController';
import { qrToWorld, axialToCube, roundToHex, cubeToAxial } from './coords';
import ChunkedLazyMapMesh from "./ChunkedLazyMapMesh";

export default class MapView implements MapViewControls, TileDataSource {
    private static DEFAULT_ZOOM = 25

    private _camera: PerspectiveCamera
    private _scene: Scene
    private _renderer: WebGLRenderer
    private _scrollDir = new Vector3(0, 0, 0)    
    private _lastTimestamp = Date.now()
    private _zoom: number = 25

    private _textureAtlas: TextureAtlas
    private _mapMesh: Object3D & TileDataSource
    private _chunkedMesh: ChunkedLazyMapMesh
    private _tileGrid: Grid<TileData> = new Grid<TileData>(0, 0)

    private _tileSelector: THREE.Object3D = DefaultTileSelector
    private _controller: MapViewController = new DefaultMapViewController()
    private _selectedTile: TileData

    private _onTileSelected: (tile: TileData) => void
    private _onLoaded: () => void

    get zoom() {
        return this._zoom
    }

    get selectedTile(): TileData {
        return this._selectedTile
    }

    getTileGrid(): Grid<TileData> {
        return this._tileGrid
    }

    setZoom(z: number) {
        this._zoom = z
        this._camera.position.z = z
        this._camera.position.y = -this.zoom * 0.95
        return this
    }

    get scrollDir() {
        return this._scrollDir
    }

    set onTileSelected(callback: (tile: TileData)=>void) {
        this._onTileSelected = callback
    }

    set onLoaded(callback: ()=>void) {
        this._onLoaded = callback
    }

    public scrollSpeed: number = 10

    constructor(canvasElementQuery: string = "canvas") {
        const canvas = document.querySelector(canvasElementQuery) as HTMLCanvasElement
        const camera = this._camera = new PerspectiveCamera(30, window.innerWidth / window.innerHeight, 1, 10000)
        const scene = this._scene = new Scene()
        const renderer = this._renderer = new THREE.WebGLRenderer({
            canvas: canvas,
            devicePixelRatio: window.devicePixelRatio
        })        

        if (renderer.extensions.get('ANGLE_instanced_arrays') === false) {
            throw new Error("Your browser is not supported (missing extension ANGLE_instanced_arrays)")
        }

        renderer.setClearColor(0x6495ED);
        renderer.setSize(window.innerWidth, window.innerHeight)

        window.addEventListener('resize', (e) => this.onWindowResize(e), false);
                
        // setup camera
        camera.rotation.x = Math.PI / 4.5        
        this.setZoom(MapView.DEFAULT_ZOOM)
        camera.position.y = -this.zoom * 0.95

        // tile selector
        this._tileSelector.position.setZ(0.1)
        this._scene.add(this._tileSelector)
        this._tileSelector.visible = true        

        // start rendering loop
        this.animate(0)
        this._controller.init(this, canvas)
    }

    load(tiles: Grid<TileData>, textureAtlas: TextureAtlas) {
        this._tileGrid = tiles
        this._textureAtlas = textureAtlas
        this._selectedTile = this._tileGrid.get(0, 0)        

        if ((tiles.width * tiles.height) < Math.pow(64, 2)) {
            const mesh = this._mapMesh = new MapMesh(tiles.toArray(), tiles, textureAtlas)
            this._scene.add(this._mapMesh)
            mesh.loaded.then(() => {
                if (this._onLoaded) this._onLoaded()
            })
            console.info("using single MapMesh for " + (tiles.width * tiles.height) + " tiles")
        } else {
            const mesh = this._mapMesh = this._chunkedMesh = new ChunkedLazyMapMesh(tiles, textureAtlas)
            this._scene.add(this._mapMesh)
            mesh.loaded.then(() => {
                if (this._onLoaded) this._onLoaded()
            })
            console.info("using ChunkedLazyMapMesh with " + mesh.numChunks + " chunks for " + (tiles.width * tiles.height) + " tiles")
        }
    }

    updateTiles(tiles: TileData[]) {
        this._mapMesh.updateTiles(tiles)
    }

    getTile(q: number, r: number) {
        return this._mapMesh.getTile(q, r)
    }

    private animate = (timestamp: number) => {
        const dtS = (timestamp - this._lastTimestamp) / 1000.0

        const camera = this._camera
        const zoomRelative = camera.position.z / MapView.DEFAULT_ZOOM
        const scroll = this._scrollDir.clone().normalize().multiplyScalar(this.scrollSpeed * zoomRelative * dtS)
        camera.position.add(scroll)

        if (this._chunkedMesh) {
            this._chunkedMesh.updateVisibility(camera)
        }

        this._renderer.render(this._scene, camera);
        requestAnimationFrame(this.animate);
        this._lastTimestamp = timestamp
    }

    onWindowResize(event: Event) {
        this._camera.aspect = window.innerWidth / window.innerHeight;
        this._camera.updateProjectionMatrix();
        this._renderer.setSize(window.innerWidth, window.innerHeight);
    }

    //----- MapViewControls -----

    setScrollDir(x: number, y: number) {
        this._scrollDir.setX(x)
        this._scrollDir.setY(y)
        this._scrollDir.normalize()
    }

    getCamera(): Camera {
        return this._camera
    }

    selectTile(tile: TileData) {        
        const worldPos = qrToWorld(tile.q, tile.r)
        this._tileSelector.position.set(worldPos.x, worldPos.y, 0.1)
        if (this._onTileSelected) {
            this._onTileSelected(tile)
        }
    }

    pickTile(worldPos: THREE.Vector3): TileData | null {
        var x = worldPos.x
        var y = worldPos.y

        // convert from world coordinates into fractal axial coordinates
        var q = (1.0 / 3 * Math.sqrt(3) * x - 1.0 / 3 * y)
        var r = 2.0 / 3 * y

        // now need to round the fractal axial coords into integer axial coords for the grid lookup
        var cubePos = axialToCube(q, r)
        var roundedCubePos = roundToHex(cubePos)
        var roundedAxialPos = cubeToAxial(roundedCubePos.x, roundedCubePos.y, roundedCubePos.z)

        // just look up the coords in our grid
        return this._tileGrid.get(roundedAxialPos.q, roundedAxialPos.r)        
    }
}