import math
from typing import Optional

class SpatialPointFilter:
    """
    AE 事件空间过滤模块，用于判定微震破裂点是否合法（不能发生在已开挖的巷道空腔内），
    以及判定其所处的围岩影响区（浅部松动圈 / 深部危险区）。
    """
    
    def __init__(self, tunnel_radius: float = 3.0, center_x: float = 0.0, center_y: float = 0.0):
        """
        初始化巷道几何模型包围盒/圆筒参数。
        
        :param tunnel_radius: 巷道开挖理论半径 (m)
        :param center_x: 巷道中轴线 X 坐标
        :param center_y: 巷道中轴线 Y 坐标
        """
        self.R = tunnel_radius
        self.cx = center_x
        self.cy = center_y

    def filter_and_categorize(self, x: float, y: float, z: float) -> Optional[str]:
        """
        计算点到巷道轴线的距离并进行分类。
        如果点落在巷道包络圆柱空腔内，直接舍弃。
        
        :param x: AE 定位点 X 坐标
        :param y: AE 定位点 Y 坐标
        :param z: AE 定位点 Z 坐标 (沿轴线，对于长直巷道主要看平面 X-Y 距离)
        :return: 对应的类别字符串 ('shallow' 或 'deep')，如果是不合法的空腔点则返回 None。
        """
        # 计算平面径向距离
        d = math.sqrt((x - self.cx)**2 + (y - self.cy)**2)
        
        # 1. 过滤：点落在模型空腔内部 (d < R) 属于不可能的物理错误，直接舍弃
        if d < self.R:
            return None
            
        # 2. 分类：判定影响分区
        # 落在 [R, R+2) 范围内，认为是浅部围岩松动点
        if d < (self.R + 2.0):
            return "shallow"
            
        # 落在 [R+2, +inf) 范围内，认为是深部积聚危险点
        return "deep"
