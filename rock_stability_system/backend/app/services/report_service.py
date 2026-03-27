import os
import math
import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics

# --- 预先尝试注册支持中文的字体 ---
# 使用系统自带的黑体或宋体等，如果没有则做后备容错。
try:
    # 针对 Windows 环境
    font_path_yh = "C:\\Windows\\Fonts\\msyh.ttc" # 微软雅黑
    if os.path.exists(font_path_yh):
        pdfmetrics.registerFont(TTFont('SimHei', font_path_yh))
        font_name = 'SimHei'
    else:
        # 尝试自带的黑体
        font_path_hei = "C:\\Windows\\Fonts\\simhei.ttf"
        if os.path.exists(font_path_hei):
            pdfmetrics.registerFont(TTFont('SimHei', font_path_hei))
            font_name = 'SimHei'
        else:
            font_name = 'Helvetica'
except Exception:
    font_name = 'Helvetica'

class ReportGenerator:
    """
    围岩稳定性报告生成器。利用 ReportLab 构造 PDF 文件。
    """
    
    def __init__(self):
        self.styles = getSampleStyleSheet()
        
        # 自定义支持中文的段落样式
        self.title_style = ParagraphStyle(
            'TitleStyle', 
            parent=self.styles['Title'],
            fontName=font_name, 
            fontSize=22,
            spaceAfter=20
        )
        self.heading_style = ParagraphStyle(
            'HeadingStyle', 
            parent=self.styles['Heading2'],
            fontName=font_name,
            spaceBefore=15,
            spaceAfter=10,
            textColor=colors.HexColor('#1f2937')
        )
        self.body_style = ParagraphStyle(
            'BodyStyle', 
            parent=self.styles['Normal'],
            fontName=font_name,
            fontSize=11,
            leading=16,
            spaceAfter=8
        )
        self.highlight_style = ParagraphStyle(
            'HighlightStyle', 
            parent=self.styles['Normal'],
            fontName=font_name,
            fontSize=11,
            leading=16,
            textColor=colors.red,
            spaceAfter=8
        )

    def _calculate_plastic_zone_radius(self, depth: float, tunnel_radius: float, c: float, phi_deg: float, inplace_stress: float) -> float:
        """
        基于 Kastner 公式估算圆形巷道均匀地应力下的塑性区半径 R_p。
        (简化模型，针对软岩或屈服岩体)
        
        :param depth: 深度 (m)
        :param tunnel_radius: 巷道开挖半径 a (m)
        :param c: 围岩黏聚力 (MPa)
        :param phi_deg: 围岩内摩擦角 (度)
        :param inplace_stress: 原岩应力 P0 (MPa)
        :return: 塑性区半径 (m)
        """
        phi_rad = math.radians(phi_deg)
        sin_phi = math.sin(phi_rad)
        
        if sin_phi == 0 or inplace_stress <= 0:
            return tunnel_radius # 弹性状态无塑性区
            
        # 支护抗力(假设无支护或极小支撑) P_i = 0
        P_i = 0.0
        
        # 弹性区边界径向应力
        sigma_R = c * math.cos(phi_rad) / sin_phi
        
        # 岩块峰值前的支承应力限值 (由莫尔库伦极值推导)
        denominator = (P_i + sigma_R) * (1 - sin_phi)
        numerator = (inplace_stress + sigma_R) * (1 - sin_phi) # 纯 Kastner 系数推导可微调
        
        # Kastner 公式 (软岩塑性圈)
        # R_p = a * [ (P0 + c*cot(phi)) * (1 - sin(phi)) / (Pi + c*cot(phi)) ] ^ ((1-sin(phi))/2*sin(phi))
        cot_phi = 1.0 / math.tan(phi_rad) if math.tan(phi_rad) != 0 else float('inf')
        
        base = (inplace_stress + c * cot_phi) * (1 - sin_phi) / (P_i + c * cot_phi + 1e-6)
        if base <= 1.0:
            return tunnel_radius # 围岩稳定，不产生塑性区
            
        exponent = (1 - sin_phi) / (2 * sin_phi)
        R_p = tunnel_radius * math.pow(base, exponent)
        
        return R_p

    def _derive_conclusion(self, R_p: float, a: float, b_value_risk: float, ae_count_24h: int) -> str:
        """
        自动生成稳定性定性结论与支护建议。
        """
        ratio = R_p / a
        conclusion = "【综合评估结论】：\n"
        
        is_creeping = (1.2 < ratio < 1.5) or (1500 < ae_count_24h < 5000)
        is_dangerous = (ratio >= 1.5) or b_value_risk > 0.7 or ae_count_24h >= 5000
        
        if is_dangerous:
            conclusion += "当前围岩处于 **严重扩容破裂阶段 / 极高岩爆风险**。塑性区恶性扩展且AE高能事件频发。\n建议：立即撤离施工作业人员，实施高强度柔性吸能支护（如恒阻大变形锚索），并进行卸压钻孔注水化解高应力。"
        elif is_creeping:
            conclusion += "当前围岩处于 **加速蠕变阶段**。塑性区存在一定范围发育，AE活跃度较高。\n建议：加强全断面锚喷网联合支护，加密表面收敛和深部多点位移计监测频率。"
        else:
            conclusion += "当前围岩处于 **弹性或稳定蠕变阶段**。内部无明显大范围损伤。\n建议：维持常规系统性锚杆支护，按标准日常巡检监测即可。"
            
        return conclusion

    def generate_pdf(self, output_path: str, params: dict):
        """
        利用给定参数生成并保存 PDF 报告。
        """
        doc = SimpleDocTemplate(output_path, pagesize=A4, rightMargin=40, leftMargin=40, topMargin=50, bottomMargin=50)
        elements = []
        
        # 1. 标题和文件头
        elements.append(Paragraph("千米深地围岩稳定性即时评估报告", self.title_style))
        elements.append(Paragraph(f"报告生成时间: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", self.body_style))
        elements.append(Paragraph(f"目标分析区段: {params.get('section_name', 'H102 试验掌子面')}", self.body_style))
        elements.append(Spacer(1, 15))
        
        # --- 力学计算与塑性区部分 ---
        elements.append(Paragraph("一、 基础地质力学参数与塑性区发育", self.heading_style))
        
        depth = params.get('depth', 1000.0)
        c = params.get('cohesion', 5.0) # MPa
        phi = params.get('friction_angle', 35.0) # 度
        p0 = params.get('inplace_stress', 27.0) # MPa
        a = params.get('tunnel_radius', 3.0) # m
        
        R_p = self._calculate_plastic_zone_radius(depth, a, c, phi, p0)
        
        mech_data = [
            ["分析深度", f"{depth} m", "原岩主应力", f"{p0:.2f} MPa"],
            ["等效黏聚力 (c)", f"{c:.2f} MPa", "等效内摩擦角 (φ)", f"{phi:.2f}°"],
            ["开挖设计半径 (a)", f"{a:.2f} m", "理论塑性区半径 (Rp)", f"{R_p:.2f} m (破裂深度 {R_p - a:.2f} m)"]
        ]
        t1 = Table(mech_data, colWidths=[110, 110, 130, 150])
        t1.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#f8fafc')),
            ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
            ('FONTNAME', (0,0), (-1,-1), font_name),
            ('FONTSIZE', (0,0), (-1,-1), 10),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('TEXTCOLOR', (1,2), (1,2), colors.blue),
            ('TEXTCOLOR', (3,2), (3,2), colors.red if R_p/a > 1.2 else colors.green),
        ]))
        elements.append(t1)
        elements.append(Spacer(1, 20))
        
        # --- AE 声发射数据总结 ---
        elements.append(Paragraph("二、 近 24 小时微震 (AE) 监测总结", self.heading_style))
        
        ae_count = params.get('ae_count_24h', 3520)
        max_energy = params.get('max_energy', 12450.5)
        b_risk = params.get('b_value_risk', 0.65)
        
        ae_text = (
            f"在过去 24 小时内，台网系统共捕获有效微震事件 <b>{ae_count}</b> 次。"
            f"记录到的单次最大释放能量达 <b>{max_energy:.2f} J</b>。 "
            f"基于G-R关系的 $b$ 值反演计算，当前时间窗范围内的岩体稳定性综合风险指数为 <b>{b_risk:.2f}</b> (0=极稳, 1=极危)。"
        )
        elements.append(Paragraph(ae_text, self.body_style))
        elements.append(Spacer(1, 20))
        
        # --- 自动结论分析 ---
        elements.append(Paragraph("三、 智能诊断与支护建议", self.heading_style))
        conclusion_text = self._derive_conclusion(R_p, a, b_risk, ae_count)
        
        # 解析换行符为段落
        for line in conclusion_text.split('\n'):
            if "严重扩容" in line or "极高岩爆" in line or "立即撤离" in line:
                elements.append(Paragraph(line, self.highlight_style))
            else:
                elements.append(Paragraph(line, self.body_style))
                
        # 结尾署名
        elements.append(Spacer(1, 40))
        elements.append(Paragraph("系统自动生成 - Antigravity Rock Stability Engine", ParagraphStyle('Footer', parent=self.styles['Normal'], fontName=font_name, fontSize=9, textColor=colors.grey, alignment=2)))
        
        doc.build(elements)
        return output_path

# 单例提供给服务调取
report_tool = ReportGenerator()
